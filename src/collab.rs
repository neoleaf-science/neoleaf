//! Real-time collaborative editing: an in-memory relay, one "room" per project + file, synchronized with a CRDT (yrs/Yjs).
//!
//! The server does NOT store the project: the room starts empty, reads and writes nothing on disk, on GitHub or anywhere
//! else, and disappears when the last person leaves. Each browser keeps the text in its own clone (BrowserGit) and sends it
//! to GitHub through its own push.
//!
//! Protocol (WebSocket):
//! - binary: `[1] + Yjs update` in both directions.
//! - text (JSON): `hello`, `join`, `leave`, `aw` (cursor/selection), `seeded`, `reseed`, `reset`, `lock` (file lock).
//!
//! Lock: with two or more people in the room, anyone can lock the file (`{"t":"lock"}`) and anyone can
//! unlock it (`{"t":"unlock"}`). While locked, only the person who locked it edits: the relay discards other people's updates.
//! The lock disappears when the locker leaves or when only one person remains. It lives only in the room's memory.
//!
//! Seeding: the room starts empty. The first person with edit permission receives `role: "seed"` in `hello`: they
//! insert the text from their browser and announce it with `seeded`. Whoever joins before that (`role: "wait"`) waits and
//! receives the state when seeding finishes. Whoever joins afterwards (`role: "join"`) gets the state right away.
//! If the seeder leaves before finishing, the room is discarded and those who were waiting reconnect (`reseed`).

use std::{
    collections::HashMap,
    panic::AssertUnwindSafe,
    sync::{
        Arc, OnceLock,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use serde_json::{Value, json};
use tokio::sync::{Mutex, broadcast};
use topcoat::router::content::websocket::{Message, WebSocket};
use yrs::{Doc, GetString, ReadTxn, StateVector, Transact, Update, updates::decoder::Decode};

use crate::auth::github::GitHubUser;

const MSG_UPDATE: u8 = 1;
const MAX_DOC_BYTES: usize = 2 * 1024 * 1024;
const MAX_ROOMS: usize = 200;
const MAX_PEERS_PER_ROOM: usize = 20;
const MAX_AWARENESS_BYTES: usize = 2048;
/// An update bigger than the document limit plus this slack is dropped.
const MAX_UPDATE_SLACK: usize = 256 * 1024;
/// Binary bytes one connection may send per minute before it is closed.
const MAX_BYTES_PER_MINUTE: usize = 16 * 1024 * 1024;
const MIN_AWARENESS_INTERVAL: Duration = Duration::from_millis(40);
const SEND_TIMEOUT: Duration = Duration::from_secs(10);
/// Simultaneous live-edit connections per person.
pub const MAX_CONNS_PER_USER: usize = 10;
const BROADCAST_CAPACITY: usize = 64;

/// How often a connection re-checks the session and the access to the project (seconds; `COLLAB_RECHECK_SECS`).
fn recheck_every() -> Duration {
    static SECS: OnceLock<u64> = OnceLock::new();
    Duration::from_secs(*SECS.get_or_init(|| {
        std::env::var("COLLAB_RECHECK_SECS")
            .ok()
            .and_then(|v| v.parse().ok())
            .filter(|n| *n > 0)
            .unwrap_or(30)
    }))
}

static CONNS: OnceLock<std::sync::Mutex<HashMap<(String, u64), usize>>> = OnceLock::new();

/// Holds one of the person's connection slots; released on drop (also when the task panics).
pub struct ConnGuard(String, u64);

impl Drop for ConnGuard {
    fn drop(&mut self) {
        let mut map = CONNS
            .get_or_init(Default::default)
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(n) = map.get_mut(&(self.0.clone(), self.1)) {
            *n = n.saturating_sub(1);
            if *n == 0 {
                map.remove(&(self.0.clone(), self.1));
            }
        }
    }
}

/// Takes a connection slot for the person (provider + numeric id), or None when they already have `MAX_CONNS_PER_USER`.
pub fn try_acquire_conn(user: &GitHubUser) -> Option<ConnGuard> {
    let key = (user.provider.id().to_string(), user.id);
    let mut map = CONNS
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let n = map.entry(key.clone()).or_insert(0);
    if *n >= MAX_CONNS_PER_USER {
        return None;
    }
    *n += 1;
    Some(ConnGuard(key.0, key.1))
}

/// Always removes the peer from the room, even if the connection task panics or is cancelled.
struct PeerGuard {
    room: Arc<Room>,
    id: u64,
}

impl Drop for PeerGuard {
    fn drop(&mut self) {
        let (room, id) = (self.room.clone(), self.id);
        tokio::spawn(async move { leave(&room, id).await });
    }
}

static NEXT_ID: AtomicU64 = AtomicU64::new(1);
static ROOMS: OnceLock<Mutex<HashMap<String, Arc<Room>>>> = OnceLock::new();

fn rooms() -> &'static Mutex<HashMap<String, Arc<Room>>> {
    ROOMS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Clone)]
enum Out {
    /// Yjs update already prefixed with the type byte.
    Update { from: u64, data: Vec<u8> },
    /// JSON message. `from == 0` is the server.
    Text { from: u64, text: String },
}

struct Peer {
    name: String,
    picture: Option<String>,
    /// Last known cursor/selection (Yjs relative positions).
    awareness: Option<Value>,
}

struct RoomInner {
    peers: HashMap<u64, Peer>,
    closed: bool,
    /// Has the initial text already been delivered by the first person?
    seeded: bool,
    /// Who is seeding (while `seeded` is false).
    seeder: Option<u64>,
    /// Who locked the file (participant id and name).
    lock: Option<(u64, String)>,
}

pub struct Room {
    /// Key in the map: project + file. The path alone is not enough: two projects both have `main.tex`.
    key: String,
    doc: Doc,
    tx: broadcast::Sender<Out>,
    inner: Mutex<RoomInner>,
}

#[derive(Clone, Copy, PartialEq)]
enum Role {
    Seed,
    Wait,
    Join,
}

impl Role {
    fn name(self) -> &'static str {
        match self {
            Role::Seed => "seed",
            Role::Wait => "wait",
            Role::Join => "join",
        }
    }
}

fn full_state(doc: &Doc) -> Vec<u8> {
    let txn = doc.transact();
    let mut data = vec![MSG_UPDATE];
    data.extend(txn.encode_state_as_update_v1(&StateVector::default()));
    data
}

fn doc_len(doc: &Doc) -> usize {
    let text = doc.get_or_insert_text("content");
    let txn = doc.transact();
    text.get_string(&txn).len()
}

/// Room key: the project and the path of the file inside it.
fn room_key(project: &str, file: &str) -> String {
    format!("{}\u{1f}{file}", project.to_lowercase())
}

/// Project and path from what the client sent: explicit `project` + path, or a composite id `project::path`.
pub fn split_target(file_id: &str, project_hint: Option<&str>) -> (String, String) {
    match project_hint.filter(|p| !p.is_empty()) {
        Some(pid) => (pid.to_string(), file_id.to_string()),
        None => crate::drive::client::decode_id(file_id),
    }
}

/// Finds the file's room, creating it empty if it does not exist yet. Nothing is read from anywhere.
pub async fn get_or_create_room(project_id: &str, file: &str) -> Result<Arc<Room>, String> {
    if project_id.is_empty() || file.is_empty() {
        return Err("project or file not provided".to_string());
    }
    let key = room_key(project_id, file);
    let mut map = rooms().lock().await;
    if let Some(room) = map.get(&key) {
        return Ok(room.clone());
    }
    if map.len() >= MAX_ROOMS {
        return Err("Server busy: too many editing rooms open".to_string());
    }
    let (tx, _) = broadcast::channel(BROADCAST_CAPACITY);
    let room = Arc::new(Room {
        key: key.clone(),
        doc: Doc::new(),
        tx,
        inner: Mutex::new(RoomInner {
            peers: HashMap::new(),
            closed: false,
            seeded: false,
            seeder: None,
            lock: None,
        }),
    });
    map.insert(key, room.clone());
    Ok(room)
}

fn peer_json(id: u64, p: &Peer) -> Value {
    let mut v = json!({ "id": id, "name": p.name, "picture": p.picture });
    if let Some(aw) = &p.awareness {
        v["anchor"] = aw["anchor"].clone();
        v["head"] = aw["head"].clone();
    }
    v
}

/// Lock state for the clients: `by` is the id of whoever locked it (or null).
fn lock_msg(lock: &Option<(u64, String)>) -> String {
    match lock {
        Some((id, name)) => json!({ "t": "lock", "by": id, "name": name }),
        None => json!({ "t": "lock", "by": null }),
    }
    .to_string()
}

fn clone_peer(p: &Peer) -> Peer {
    Peer {
        name: p.name.clone(),
        picture: p.picture.clone(),
        awareness: None,
    }
}

/// What the connection loop does after handling one event.
#[derive(PartialEq, Eq)]
enum Flow {
    Next,
    Stop,
}

/// Per-connection rate state (all in RAM, gone with the connection).
struct Limits {
    window_start: Instant,
    window_bytes: usize,
    last_reject: Option<Instant>,
    last_aw: Option<Instant>,
}

impl Limits {
    fn new() -> Self {
        Limits {
            window_start: Instant::now(),
            window_bytes: 0,
            last_reject: None,
            last_aw: None,
        }
    }

    /// Counts a binary frame; false when the byte budget of the current minute is spent.
    fn spend(&mut self, n: usize) -> bool {
        if self.window_start.elapsed() >= Duration::from_secs(60) {
            self.window_start = Instant::now();
            self.window_bytes = 0;
        }
        self.window_bytes = self.window_bytes.saturating_add(n);
        self.window_bytes <= MAX_BYTES_PER_MINUTE
    }
}

/// Sends one message, giving up (and so dropping the peer) when it cannot be taken within `SEND_TIMEOUT`.
async fn send(socket: &mut WebSocket, msg: Message) -> bool {
    matches!(
        tokio::time::timeout(SEND_TIMEOUT, socket.send(msg)).await,
        Ok(Ok(()))
    )
}

/// Discards an update: tells the client and sends it the room's text (at most once per second per peer).
async fn reject(socket: &mut WebSocket, room: &Arc<Room>, lim: &mut Limits) -> Flow {
    if lim
        .last_reject
        .is_some_and(|t| t.elapsed() < Duration::from_secs(1))
    {
        return Flow::Next;
    }
    lim.last_reject = Some(Instant::now());
    if !send(
        socket,
        Message::text(json!({ "t": "rejected" }).to_string()),
    )
    .await
    {
        return Flow::Stop;
    }
    if !send(socket, Message::binary(full_state(&room.doc))).await {
        return Flow::Stop;
    }
    Flow::Next
}

/// Handles a binary Yjs update from a peer: rejects it while someone else holds the lock or the document is full, otherwise applies and relays it.
async fn handle_binary(
    socket: &mut WebSocket,
    room: &Arc<Room>,
    id: u64,
    can_edit: bool,
    email: &str,
    data: &[u8],
    lim: &mut Limits,
) -> Flow {
    if !can_edit
        || data.first() != Some(&MSG_UPDATE)
        || data.len() > MAX_DOC_BYTES + MAX_UPDATE_SLACK
    {
        return Flow::Next;
    }
    // The room guard is held from the lock check until the update is applied (all synchronous): nothing slips in between.
    let inner = room.inner.lock().await;
    // file locked by someone else, or document already at the limit: discard and send the current text (the client rebuilds its copy)
    if inner.lock.as_ref().is_some_and(|(by, _)| *by != id) || doc_len(&room.doc) >= MAX_DOC_BYTES {
        drop(inner);
        return reject(socket, room, lim).await;
    }
    // attacker bytes: a panic inside yrs only drops this peer
    let applied = std::panic::catch_unwind(AssertUnwindSafe(|| {
        let update = Update::decode_v1(&data[1..]).ok()?;
        let mut txn = room.doc.transact_mut_with(email);
        txn.apply_update(update).ok()
    }));
    match applied {
        Err(_) => {
            eprintln!("A panic while applying a collaborative update: peer dropped");
            return Flow::Stop;
        }
        Ok(None) => return Flow::Next,
        Ok(Some(())) => {}
    }
    let _ = room.tx.send(Out::Update {
        from: id,
        data: data.to_vec(),
    });
    drop(inner);
    Flow::Next
}

/// Handles a JSON control message (awareness, lock, unlock, seeded) from a peer.
async fn handle_text(
    room: &Arc<Room>,
    id: u64,
    can_edit: bool,
    text: &str,
    lim: &mut Limits,
) -> Flow {
    if text.len() > MAX_AWARENESS_BYTES {
        return Flow::Next;
    }
    let Ok(v) = serde_json::from_str::<Value>(text) else {
        return Flow::Next;
    };
    match v["t"].as_str() {
        Some("aw") => {
            // too frequent cursor updates are dropped silently
            if lim
                .last_aw
                .is_some_and(|t| t.elapsed() < MIN_AWARENESS_INTERVAL)
            {
                return Flow::Next;
            }
            lim.last_aw = Some(Instant::now());
            return handle_awareness(room, id, &v).await;
        }
        Some(k @ ("lock" | "unlock")) => handle_lock(room, id, can_edit, k).await,
        Some("seeded") => handle_seeded(room, id).await,
        _ => {}
    }
    Flow::Next
}

/// Stores the peer's cursor/selection and relays it to the others.
async fn handle_awareness(room: &Arc<Room>, id: u64, v: &Value) -> Flow {
    let aw = json!({ "anchor": v["anchor"], "head": v["head"] });
    let out = {
        let mut inner = room.inner.lock().await;
        let Some(p) = inner.peers.get_mut(&id) else {
            return Flow::Stop;
        };
        p.awareness = Some(aw);
        let mut o = peer_json(id, p);
        o["t"] = json!("aw");
        o
    };
    let _ = room.tx.send(Out::Text {
        from: id,
        text: out.to_string(),
    });
    Flow::Next
}

/// Locks or unlocks the file for the room and tells everyone.
async fn handle_lock(room: &Arc<Room>, id: u64, can_edit: bool, kind: &str) {
    if !can_edit {
        return;
    }
    let msg = {
        let mut inner = room.inner.lock().await;
        if kind == "lock" {
            // only locks with more than one person and if nobody locked it before
            if inner.peers.len() < 2 || inner.lock.is_some() {
                return;
            }
            let name = inner
                .peers
                .get(&id)
                .map(|p| p.name.clone())
                .unwrap_or_default();
            inner.lock = Some((id, name));
        } else {
            if inner.lock.is_none() {
                return;
            }
            inner.lock = None;
        }
        lock_msg(&inner.lock)
    };
    // from 0: reaches everyone, including who asked
    let _ = room.tx.send(Out::Text { from: 0, text: msg });
}

/// Seeding finished (the text arrived earlier, in the binary message): releases those who were waiting.
async fn handle_seeded(room: &Arc<Room>, id: u64) {
    let mut inner = room.inner.lock().await;
    if inner.seeder == Some(id) && !inner.seeded {
        inner.seeded = true;
        inner.seeder = None;
        drop(inner);
        let _ = room.tx.send(Out::Update {
            from: id,
            data: full_state(&room.doc),
        });
    }
}

/// Forwards a broadcast from the room to this peer's socket (ignores its own messages).
async fn forward_broadcast(
    socket: &mut WebSocket,
    room: &Arc<Room>,
    id: u64,
    out: Result<Out, broadcast::error::RecvError>,
) -> Flow {
    match out {
        Ok(Out::Update { from, data }) if from != id => {
            if !send(socket, Message::binary(data)).await {
                return Flow::Stop;
            }
        }
        Ok(Out::Text { from, text }) if from != id => {
            if !send(socket, Message::text(text)).await {
                return Flow::Stop;
            }
        }
        Ok(_) => {}
        // Fell behind: resend the full state (updates are idempotent).
        Err(broadcast::error::RecvError::Lagged(_)) => {
            if !send(socket, Message::binary(full_state(&room.doc))).await {
                return Flow::Stop;
            }
        }
        Err(broadcast::error::RecvError::Closed) => return Flow::Stop,
    }
    Flow::Next
}

/// Serves a WebSocket connection until it ends. `conn` is the person's connection slot (released when this ends).
pub async fn serve(
    mut socket: WebSocket,
    room: Arc<Room>,
    user: GitHubUser,
    sid: String,
    mut can_edit: bool,
    project: String,
    conn: ConnGuard,
) {
    let _conn = conn;
    let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
    // the e-mail stays here (transaction origin) and is never sent to other people
    let email = user.email.clone().unwrap_or_else(|| {
        format!(
            "{}@users.noreply.{}",
            user.login,
            if user.provider == crate::provider::Provider::Codeberg {
                "codeberg.org"
            } else {
                "github.com"
            }
        )
    });
    let me = Peer {
        name: user.name.clone().unwrap_or_else(|| user.login.clone()),
        picture: user.avatar_url.clone(),
        awareness: None,
    };

    // Subscribe before taking the state snapshot, so no updates are lost in between.
    let mut rx = room.tx.subscribe();
    let (others, role, lock0): (Vec<Value>, Role, Option<(u64, String)>) = {
        let mut inner = room.inner.lock().await;
        if inner.closed || inner.peers.len() >= MAX_PEERS_PER_ROOM {
            drop(inner);
            let _ = socket.close().await;
            return;
        }
        let role = if inner.seeded {
            Role::Join
        } else if inner.seeder.is_none() && can_edit {
            inner.seeder = Some(id);
            Role::Seed
        } else {
            Role::Wait
        };
        let list = inner
            .peers
            .iter()
            .map(|(pid, p)| peer_json(*pid, p))
            .collect();
        inner.peers.insert(id, clone_peer(&me));
        (list, role, inner.lock.clone())
    };
    // from here on the peer is always removed, whatever happens (panic, cancellation, error)
    let _peer = PeerGuard {
        room: room.clone(),
        id,
    };

    let _ = room.tx.send(Out::Text {
        from: id,
        text: json!({ "t": "join", "id": id, "name": me.name, "picture": me.picture }).to_string(),
    });

    let hello = json!({ "t": "hello", "id": id, "canEdit": can_edit, "role": role.name(), "peers": others, "lock": lock0.map(|(by, name)| json!({ "by": by, "name": name })) }).to_string();
    let mut ok = send(&mut socket, Message::text(hello)).await;
    if ok && role == Role::Join {
        ok = send(&mut socket, Message::binary(full_state(&room.doc))).await;
    }

    if ok {
        let mut lim = Limits::new();
        let mut tick = tokio::time::interval(recheck_every());
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        tick.tick().await; // the first tick is immediate
        loop {
            tokio::select! {
                incoming = socket.recv() => {
                    let Some(Ok(msg)) = incoming else { break };
                    // session ended during editing (signed out, was blocked or deleted the account): disconnect
                    if crate::session::active(&sid).await.is_none() { break; }
                    let flow = match msg {
                        Message::Binary(data) => {
                            if !lim.spend(data.len()) { break; }
                            handle_binary(&mut socket, &room, id, can_edit, &email, &data, &mut lim).await
                        }
                        Message::Text(text) => handle_text(&room, id, can_edit, text.as_str(), &mut lim).await,
                        Message::Close(_) => Flow::Stop,
                        _ => Flow::Next,
                    };
                    if flow == Flow::Stop { break; }
                }
                out = rx.recv() => {
                    if forward_broadcast(&mut socket, &room, id, out).await == Flow::Stop { break; }
                }
                _ = tick.tick() => {
                    // also for people who only listen: the session and the access to the project are checked again
                    let Some(active) = crate::session::active(&sid).await else { break };
                    let (can_read, can_write) = crate::drive::client::DriveClient::for_session(&active).project_access_cached(&project, false).await;
                    if !can_read { break; }
                    if !can_write { can_edit = false; }
                }
            }
        }
    }
    let _ = socket.close().await;
}

async fn leave(room: &Arc<Room>, id: u64) {
    let (empty, lost_seeder) = {
        let mut inner = room.inner.lock().await;
        inner.peers.remove(&id);
        // the lock disappears when the locker leaves or when only one person remains
        if (inner.lock.as_ref().is_some_and(|(by, _)| *by == id) || inner.peers.len() < 2)
            && inner.lock.take().is_some()
        {
            let _ = room.tx.send(Out::Text {
                from: 0,
                text: lock_msg(&None),
            });
        }
        let lost = inner.seeder == Some(id) && !inner.seeded;
        if lost {
            inner.seeder = None;
            inner.closed = true; // room without initial text: those who were waiting reconnect to a new room
        }
        (inner.peers.is_empty(), lost)
    };
    let _ = room.tx.send(Out::Text {
        from: id,
        text: json!({ "t": "leave", "id": id }).to_string(),
    });
    if lost_seeder {
        let _ = room.tx.send(Out::Text {
            from: 0,
            text: json!({ "t": "reseed" }).to_string(),
        });
    }

    if empty || lost_seeder {
        // Last person left (or seeding was lost): free the room's memory. The text is not written anywhere.
        let mut map = rooms().lock().await;
        let mut inner = room.inner.lock().await;
        if inner.peers.is_empty() || lost_seeder {
            inner.closed = true;
            // only remove from the map if it is this same room (after a reset another with the same key may already exist)
            if map.get(&room.key).is_some_and(|r| Arc::ptr_eq(r, room)) {
                map.remove(&room.key);
            }
        }
    }
}

/// Returns the number of active rooms and the total number of collaborators connected to them.
pub async fn active_rooms_info() -> (usize, usize) {
    let r = rooms().lock().await;
    let mut total_peers = 0;
    for room in r.values() {
        total_peers += room.inner.lock().await.peers.len();
    }
    (r.len(), total_peers)
}
