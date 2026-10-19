var Queue = class {
	_queue;
	_onEmptyCallback;
	_active;
	constructor(onEmptyCallback) {
		this._queue = [];
		this._onEmptyCallback = onEmptyCallback;
	}
	queue(func) {
		this._queue.push(func);
		if (this._queue.length === 1 && !this._active) this._progressQueue();
	}
	_progressQueue() {
		if (!this._queue.length) {
			this._onEmptyCallback();
			return;
		}
		let f = this._queue.shift();
		this._active = true;
		f(this.next.bind(this));
	}
	clear() {
		this._queue = [];
	}
	next() {
		this._active = false;
		this._progressQueue();
	}
	dispose() {
		this._queue = [];
		this._active = false;
		this._onEmptyCallback = () => {};
	}
};
var Animator = class Animator {
	_el;
	_data;
	_mapUrl;
	_currentFrameIndex;
	_currentFrame;
	_exiting;
	_currentAnimation;
	_endCallback;
	_started;
	_sounds;
	currentAnimationName;
	_overlays;
	_loop;
	static States;
	constructor(el, mapUrl, data, sounds) {
		this._el = el;
		this._data = data;
		this._mapUrl = mapUrl;
		this._currentFrameIndex = 0;
		this._currentFrame = void 0;
		this._exiting = false;
		this._currentAnimation = void 0;
		this._endCallback = void 0;
		this._started = false;
		this._sounds = {};
		this.currentAnimationName = void 0;
		this.preloadSounds(sounds);
		this._overlays = [this._el];
		let curr = this._el;
		this._setupElement(this._el);
		for (let i = 1; i < this._data.overlayCount; i++) {
			let inner = this._setupElement(document.createElement("div"));
			curr.appendChild(inner);
			this._overlays.push(inner);
			curr = inner;
		}
	}
	_setupElement(el) {
		let frameSize = this._data.framesize;
		el.style.display = "none";
		el.style.width = frameSize[0] + "px";
		el.style.height = frameSize[1] + "px";
		el.style.background = "url('" + this._mapUrl + "') no-repeat";
		return el;
	}
	animations() {
		let r = [];
		let d = this._data.animations;
		for (let n in d) r.push(n);
		return r;
	}
	preloadSounds(sounds) {
		for (let i = 0; i < this._data.sounds.length; i++) {
			let snd = this._data.sounds[i];
			let uri = sounds[snd];
			if (!uri) continue;
			this._sounds[snd] = new Audio(uri);
		}
	}
	hasAnimation(name) {
		return !!this._data.animations[name];
	}
	exitAnimation() {
		this._exiting = true;
	}
	showAnimation(animationName, stateChangeCallback) {
		this._exiting = false;
		if (!this.hasAnimation(animationName)) return false;
		this._currentAnimation = this._data.animations[animationName];
		this.currentAnimationName = animationName;
		if (!this._started) {
			this._step();
			this._started = true;
		}
		this._currentFrameIndex = 0;
		this._currentFrame = void 0;
		this._endCallback = stateChangeCallback;
		return true;
	}
	_draw() {
		let images = [];
		if (this._currentFrame) images = this._currentFrame.images || [];
		for (let i = 0; i < this._overlays.length; i++) if (i < images.length) {
			let xy = images[i];
			let bg = -xy[0] + "px " + -xy[1] + "px";
			this._overlays[i].style.backgroundPosition = bg;
			this._overlays[i].style.display = "block";
		} else this._overlays[i].style.display = "none";
	}
	_getNextAnimationFrame() {
		if (!this._currentAnimation) return void 0;
		if (!this._currentFrame) return 0;
		let currentFrame = this._currentFrame;
		let branching = this._currentFrame.branching;
		if (this._exiting && currentFrame.exitBranch !== void 0) return currentFrame.exitBranch;
		else if (branching) {
			let rnd = Math.random() * 100;
			for (let i = 0; i < branching.branches.length; i++) {
				let branch = branching.branches[i];
				if (rnd <= branch.weight) return branch.frameIndex;
				rnd -= branch.weight;
			}
		}
		return this._currentFrameIndex + 1;
	}
	_playSound() {
		let s = this._currentFrame.sound;
		if (!s) return;
		let audio = this._sounds[s];
		if (audio) audio.play().catch(() => {});
	}
	_atLastFrame() {
		return this._currentFrameIndex >= this._currentAnimation.frames.length - 1;
	}
	_step() {
		if (!this._currentAnimation) return;
		let newFrameIndex = Math.min(this._getNextAnimationFrame(), this._currentAnimation.frames.length - 1);
		let frameChanged = !this._currentFrame || this._currentFrameIndex !== newFrameIndex;
		this._currentFrameIndex = newFrameIndex;
		if (!(this._atLastFrame() && this._currentAnimation.useExitBranching)) this._currentFrame = this._currentAnimation.frames[this._currentFrameIndex];
		this._draw();
		this._playSound();
		this._loop = window.setTimeout(this._step.bind(this), this._currentFrame.duration);
		if (this._endCallback && frameChanged && this._atLastFrame()) if (this._currentAnimation.useExitBranching && !this._exiting) this._endCallback(this.currentAnimationName, Animator.States.WAITING);
		else this._endCallback(this.currentAnimationName, Animator.States.EXITED);
	}
	pause() {
		window.clearTimeout(this._loop);
	}
	resume() {
		this._step();
	}
	dispose() {
		window.clearTimeout(this._loop);
		this._currentAnimation = void 0;
		this._currentFrame = void 0;
		this._endCallback = void 0;
		this._started = false;
		for (const key in this._sounds) {
			this._sounds[key].pause();
			this._sounds[key].src = "";
		}
		this._sounds = {};
	}
};
Animator.States = {
	WAITING: 1,
	EXITED: 0
};
var Balloon = class {
	_targetEl;
	_balloon;
	_content;
	_tip;
	_hidden;
	_active;
	_hold;
	_hiding;
	WORD_SPEAK_TIME;
	CLOSE_BALLOON_DELAY;
	_BALLOON_MARGIN;
	_complete;
	_addWord;
	_loop;
	constructor(targetEl) {
		this._targetEl = targetEl;
		this._hidden = true;
		this._setup();
		this.WORD_SPEAK_TIME = 200;
		this.CLOSE_BALLOON_DELAY = 5e3;
		this._BALLOON_MARGIN = 15;
	}
	_setup() {
		this._balloon = document.createElement("div");
		Object.assign(this._balloon.style, {
			position: "fixed",
			zIndex: "10001",
			cursor: "pointer",
			background: "#ffc",
			color: "black",
			padding: "8px",
			border: "1px solid black",
			borderRadius: "5px",
			display: "none",
			maxWidth: "230px"
		});
		this._tip = document.createElement("div");
		Object.assign(this._tip.style, {
			width: "10px",
			height: "16px",
			background: "url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAgCAMAAAAlvKiEAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAAlQTFRF///MAAAA////52QwgAAAAAN0Uk5T//8A18oNQQAAAGxJREFUeNqs0kEOwCAIRFHn3//QTUU6xMyyxii+jQosrTPkyPEM6IN3FtzIRk1U4dFeKWQiH6pRRowMVKEmvronEynkwj0uZJgR22+YLopPSo9P34wJSamLSU7lSIWLJU7NkNomNlhqxUeAAQC+TQLZyEuJBwAAAABJRU5ErkJggg==) no-repeat",
			position: "absolute"
		});
		this._content = document.createElement("div");
		Object.assign(this._content.style, {
			maxWidth: "200px",
			minWidth: "120px",
			fontFamily: "\"Microsoft Sans\", sans-serif",
			fontSize: "10pt",
			whiteSpace: "pre-wrap",
			wordWrap: "break-word",
			overflowWrap: "break-word"
		});
		this._balloon.appendChild(this._tip);
		this._balloon.appendChild(this._content);
		document.body.appendChild(this._balloon);
	}
	reposition() {
		let sides = [
			"top-left",
			"top-right",
			"bottom-left",
			"bottom-right"
		];
		for (let i = 0; i < sides.length; i++) {
			let s = sides[i];
			this._position(s);
			if (!this._isOut()) break;
		}
	}
	_position(side) {
		let o = this._targetEl.getBoundingClientRect();
		let h = this._targetEl.offsetHeight;
		let w = this._targetEl.offsetWidth;
		let bH = this._balloon.offsetHeight;
		let bW = this._balloon.offsetWidth;
		let left, top;
		switch (side) {
			case "top-left":
				left = o.left + w - bW;
				top = o.top - bH - this._BALLOON_MARGIN;
				break;
			case "top-right":
				left = o.left;
				top = o.top - bH - this._BALLOON_MARGIN;
				break;
			case "bottom-right":
				left = o.left;
				top = o.top + h + this._BALLOON_MARGIN;
				break;
			case "bottom-left":
				left = o.left + w - bW;
				top = o.top + h + this._BALLOON_MARGIN;
				break;
		}
		this._balloon.style.top = top + "px";
		this._balloon.style.left = left + "px";
		this._positionTip(side);
	}
	_positionTip(side) {
		const s = this._tip.style;
		s.top = "";
		s.left = "";
		s.marginTop = "";
		s.marginLeft = "";
		s.backgroundPosition = "";
		switch (side) {
			case "top-left":
				s.top = "100%";
				s.marginTop = "0px";
				s.left = "100%";
				s.marginLeft = "-50px";
				break;
			case "top-right":
				s.top = "100%";
				s.marginTop = "0px";
				s.left = "0";
				s.marginLeft = "50px";
				s.backgroundPosition = "-10px 0";
				break;
			case "bottom-right":
				s.top = "0";
				s.marginTop = "-16px";
				s.left = "0";
				s.marginLeft = "50px";
				s.backgroundPosition = "-10px -16px";
				break;
			case "bottom-left":
				s.top = "0";
				s.marginTop = "-16px";
				s.left = "100%";
				s.marginLeft = "-50px";
				s.backgroundPosition = "0px -16px";
				break;
		}
	}
	_isOut() {
		let o = this._balloon.getBoundingClientRect();
		let bH = this._balloon.offsetHeight;
		let bW = this._balloon.offsetWidth;
		let wW = window.innerWidth;
		let wH = window.innerHeight;
		let top = o.top;
		let left = o.left;
		let m = 5;
		if (top - m < 0 || left - m < 0) return true;
		return top + bH + m > wH || left + bW + m > wW;
	}
	speak(complete, text, hold) {
		this._hidden = false;
		this.show();
		let c = this._content;
		c.style.height = "auto";
		c.style.width = "auto";
		c.textContent = text;
		let w = c.offsetWidth;
		c.style.width = w + "px";
		c.style.height = c.offsetHeight + "px";
		c.textContent = "";
		this.reposition();
		this._complete = complete;
		this._sayWords(text, hold, complete);
	}
	show() {
		if (this._hidden) return;
		this._balloon.style.display = "block";
	}
	hide(fast) {
		if (fast) {
			this._balloon.style.display = "none";
			return;
		}
		this._hiding = window.setTimeout(this._finishHideBalloon.bind(this), this.CLOSE_BALLOON_DELAY);
	}
	_finishHideBalloon() {
		if (this._active) return;
		this._balloon.style.display = "none";
		this._hidden = true;
		this._hiding = null;
	}
	_sayWords(text, hold, complete) {
		this._active = true;
		this._hold = hold;
		let words = text.split(/( +|\n)/);
		let time = this.WORD_SPEAK_TIME;
		let el = this._content;
		let idx = 1;
		this._addWord = () => {
			if (!this._active) return;
			if (idx > words.length) {
				delete this._addWord;
				this._active = false;
				if (!this._hold) {
					complete();
					this.hide();
				}
			} else {
				el.textContent = words.slice(0, idx).join("");
				idx += 2;
				this._loop = window.setTimeout(this._addWord, time);
			}
		};
		this._addWord();
	}
	speakStream(complete) {
		this._hidden = false;
		this._active = true;
		this._hold = true;
		this._complete = complete;
		this.show();
		let c = this._content;
		c.style.height = "auto";
		c.style.width = "auto";
		c.textContent = "";
		this.reposition();
		let text = "";
		return {
			push: (chunk) => {
				text += chunk;
				c.textContent = text;
				c.style.height = "auto";
				c.style.width = "auto";
				let w = c.offsetWidth;
				c.style.width = w + "px";
				c.style.height = c.offsetHeight + "px";
				this.reposition();
			},
			done: () => {
				this._active = false;
				this._hold = false;
				complete();
				this.hide();
			}
		};
	}
	close() {
		if (this._active) this._hold = false;
		else if (this._hold) this._complete();
	}
	pause() {
		window.clearTimeout(this._loop);
		if (this._hiding) {
			window.clearTimeout(this._hiding);
			this._hiding = null;
		}
	}
	resume() {
		if (this._addWord) this._addWord();
		else if (!this._hold && !this._hidden) this._hiding = window.setTimeout(this._finishHideBalloon.bind(this), this.CLOSE_BALLOON_DELAY);
	}
	dispose() {
		window.clearTimeout(this._loop);
		if (this._hiding) {
			window.clearTimeout(this._hiding);
			this._hiding = null;
		}
		this._active = false;
		this._addWord = void 0;
		this._balloon.remove();
	}
};
var Agent = class {
	_queue;
	_el;
	_animator;
	_balloon;
	_hidden;
	_idlePromise;
	_idleResolve;
	_offset;
	_targetX;
	_targetY;
	_moveHandle;
	_upHandle;
	_dragUpdateLoop;
	_dragging;
	_resizeHandle;
	_pointerDownHandle;
	_dblClickHandle;
	_tts;
	constructor(mapUrl, data, sounds) {
		this._queue = new Queue(this._onQueueEmpty.bind(this));
		this._el = document.createElement("div");
		Object.assign(this._el.style, {
			position: "fixed",
			zIndex: "10001",
			cursor: "pointer",
			display: "none",
			touchAction: "none"
		});
		document.body.appendChild(this._el);
		this._animator = new Animator(this._el, mapUrl, data, sounds);
		this._balloon = new Balloon(this._el);
		this._tts = data.tts;
		this._setupEvents();
	}
	gestureAt(x, y) {
		let d = this._getDirection(x, y);
		let gAnim = "Gesture" + d;
		let lookAnim = "Look" + d;
		let animation = this.hasAnimation(gAnim) ? gAnim : lookAnim;
		return this.play(animation);
	}
	hide(fast, callback) {
		this._hidden = true;
		let el = this._el;
		this.stop();
		if (fast) {
			this._el.style.display = "none";
			this.stop();
			this.pause();
			if (callback) callback();
			return;
		}
		return this._playInternal("Hide", function() {
			el.style.display = "none";
			this.pause();
			if (callback) callback();
		});
	}
	moveTo(x, y, duration) {
		let anim = "Move" + this._getDirection(x, y);
		if (duration === void 0) duration = 1e3;
		this._addToQueue(function(complete) {
			let clamped = this._clampXY(x, y);
			let cx = clamped.x;
			let cy = clamped.y;
			if (duration === 0) {
				this._el.style.top = cy + "px";
				this._el.style.left = cx + "px";
				this.reposition();
				complete();
				return;
			}
			if (!this.hasAnimation(anim)) {
				this._animate(this._el, {
					top: cy,
					left: cx
				}, duration, complete);
				return;
			}
			let callback = (name, state) => {
				if (state === Animator.States.EXITED) complete();
				if (state === Animator.States.WAITING) this._animate(this._el, {
					top: cy,
					left: cx
				}, duration, () => {
					this._animator.exitAnimation();
				});
			};
			this._playInternal(anim, callback);
		}, this);
	}
	_animate(element, props, duration, callback) {
		const start = performance.now();
		const startProps = {};
		for (let prop in props) startProps[prop] = parseFloat(getComputedStyle(element)[prop]) || 0;
		const swing = (p) => .5 - Math.cos(p * Math.PI) / 2;
		const animate = (currentTime) => {
			const elapsed = currentTime - start;
			const progress = Math.min(elapsed / duration, 1);
			const eased = swing(progress);
			for (let prop in props) {
				const startValue = startProps[prop];
				const currentValue = startValue + (props[prop] - startValue) * eased;
				element.style[prop] = currentValue + "px";
			}
			if (progress < 1) requestAnimationFrame(animate);
			else if (callback) callback();
		};
		requestAnimationFrame(animate);
	}
	_playInternal(animation, callback) {
		if (this._isIdleAnimation() && this._idlePromise) {
			this._idlePromise.then(() => {
				this._playInternal(animation, callback);
			});
			return;
		}
		this._animator.showAnimation(animation, callback);
	}
	play(animation, timeout, cb) {
		if (!this.hasAnimation(animation)) return false;
		if (timeout === void 0) timeout = 5e3;
		this._addToQueue(function(complete) {
			let completed = false;
			let callback = function(name, state) {
				if (state === Animator.States.EXITED) {
					completed = true;
					if (cb) cb();
					complete();
				}
			};
			if (timeout) window.setTimeout(() => {
				if (completed) return;
				this._animator.exitAnimation();
			}, timeout);
			this._playInternal(animation, callback);
		}, this);
		return true;
	}
	show(fast) {
		this._hidden = false;
		if (fast) {
			this._el.style.display = "block";
			this.resume();
			this._onQueueEmpty();
			return;
		}
		const style = getComputedStyle(this._el);
		if (style.top === "auto" || style.left === "auto") {
			let left = (window.innerWidth - this._el.offsetWidth) / 2;
			let clamped = this._clampXY(left, 40);
			this._el.style.top = clamped.y + "px";
			this._el.style.left = clamped.x + "px";
		}
		this.resume();
		return this.play("Show");
	}
	speak(text, options) {
		this._addToQueue(function(complete) {
			this._balloon.speak(complete, text, options?.hold);
			if (options?.tts) this._speakTTS(text);
		}, this);
	}
	async speakStream(source, options) {
		this.stop();
		let text = "";
		const stream = this._balloon.speakStream(() => {
			this._onQueueEmpty();
		});
		for await (const chunk of source) {
			text += chunk;
			stream.push(chunk);
		}
		if (options?.tts && text) this._speakTTS(text);
		stream.done();
	}
	closeBalloon() {
		this._balloon.hide();
	}
	delay(time) {
		time = time || 250;
		this._addToQueue(function(complete) {
			this._onQueueEmpty();
			window.setTimeout(complete, time);
		});
	}
	stopCurrent() {
		this._animator.exitAnimation();
		this._balloon.close();
	}
	stop() {
		this._queue.clear();
		this._animator.exitAnimation();
		this._balloon.hide();
		if (this._tts && "speechSynthesis" in window) speechSynthesis.cancel();
	}
	hasAnimation(name) {
		return this._animator.hasAnimation(name);
	}
	animations() {
		return this._animator.animations();
	}
	animate() {
		let animations = this.animations();
		let anim = animations[Math.floor(Math.random() * animations.length)];
		if (anim.indexOf("Idle") === 0) return this.animate();
		return this.play(anim);
	}
	_getDirection(x, y) {
		let rect = this._el.getBoundingClientRect();
		let h = this._el.offsetHeight;
		let w = this._el.offsetWidth;
		let centerX = rect.left + w / 2;
		let a = rect.top + h / 2 - y;
		let b = centerX - x;
		let r = Math.round(180 * Math.atan2(a, b) / Math.PI);
		if (-45 <= r && r < 45) return "Right";
		if (45 <= r && r < 135) return "Up";
		if (135 <= r && r <= 180 || -180 <= r && r < -135) return "Left";
		if (-135 <= r && r < -45) return "Down";
		return "Top";
	}
	_onQueueEmpty() {
		if (this._hidden || this._isIdleAnimation()) return;
		let idleAnim = this._getIdleAnimation();
		this._idlePromise = new Promise((resolve) => {
			this._idleResolve = resolve;
		});
		this._animator.showAnimation(idleAnim, this._onIdleComplete.bind(this));
	}
	_onIdleComplete(name, state) {
		if (state === Animator.States.EXITED) {
			if (this._idleResolve) this._idleResolve();
			this._idlePromise = null;
			this._idleResolve = null;
		}
	}
	_isIdleAnimation() {
		let c = this._animator.currentAnimationName;
		return c && c.indexOf("Idle") === 0;
	}
	_getIdleAnimation() {
		let animations = this.animations();
		let r = [];
		for (let i = 0; i < animations.length; i++) {
			let a = animations[i];
			if (a.indexOf("Idle") === 0) r.push(a);
		}
		return r[Math.floor(Math.random() * r.length)];
	}
	_setupEvents() {
		this._resizeHandle = this.reposition.bind(this);
		this._pointerDownHandle = this._onPointerDown.bind(this);
		this._dblClickHandle = this._onDoubleClick.bind(this);
		window.addEventListener("resize", this._resizeHandle);
		this._el.addEventListener("mousedown", this._pointerDownHandle);
		this._el.addEventListener("touchstart", this._pointerDownHandle, { passive: false });
		this._el.addEventListener("dblclick", this._dblClickHandle);
	}
	_onDoubleClick() {
		if (!this.play("ClickedOn")) this.animate();
	}
	reposition() {
		const style = getComputedStyle(this._el);
		if (style.display === "none") return;
		if (style.visibility === "hidden") return;
		if (style.width === "0" || style.height === "0") return;
		let o = this._el.getBoundingClientRect();
		let bH = this._el.offsetHeight;
		let bW = this._el.offsetWidth;
		let wW = window.innerWidth;
		let wH = window.innerHeight;
		let top = o.top;
		let left = o.left;
		let m = 5;
		if (top - m < 0) top = m;
		else if (top + bH + m > wH) top = wH - bH - m;
		if (left - m < 0) left = m;
		else if (left + bW + m > wW) left = wW - bW - m;
		this._el.style.left = left + "px";
		this._el.style.top = top + "px";
		this._balloon.reposition();
	}
	_onPointerDown(e) {
		e.preventDefault();
		this._startDrag(e);
	}
	_startDrag(e) {
		this.pause();
		this._balloon.hide(true);
		this._offset = this._calculateClickOffset(e);
		this._moveHandle = this._dragMove.bind(this);
		this._upHandle = this._finishDrag.bind(this);
		window.addEventListener("mousemove", this._moveHandle);
		window.addEventListener("mouseup", this._upHandle);
		window.addEventListener("touchmove", this._moveHandle, { passive: false });
		window.addEventListener("touchend", this._upHandle);
		this._dragUpdateLoop = window.setTimeout(this._updateLocation.bind(this), 10);
	}
	_calculateClickOffset(e) {
		let point = "touches" in e ? e.touches[0] : e;
		let o = this._el.getBoundingClientRect();
		return {
			top: point.pageY - (o.top + window.pageYOffset),
			left: point.pageX - (o.left + window.pageXOffset)
		};
	}
	_updateLocation() {
		this._el.style.top = this._targetY + "px";
		this._el.style.left = this._targetX + "px";
		this._dragUpdateLoop = window.setTimeout(this._updateLocation.bind(this), 10);
	}
	_dragMove(e) {
		e.preventDefault();
		let point = "touches" in e ? e.touches[0] : e;
		let x = point.clientX - this._offset.left;
		let y = point.clientY - this._offset.top;
		this._targetX = x;
		this._targetY = y;
		this._clampTarget();
	}
	_finishDrag() {
		window.clearTimeout(this._dragUpdateLoop);
		window.removeEventListener("mousemove", this._moveHandle);
		window.removeEventListener("mouseup", this._upHandle);
		window.removeEventListener("touchmove", this._moveHandle);
		window.removeEventListener("touchend", this._upHandle);
		this._balloon.show();
		this.reposition();
		this.resume();
	}
	_clampTarget() {
		let m = 5;
		let bW = this._el.offsetWidth;
		let bH = this._el.offsetHeight;
		let wW = window.innerWidth;
		let wH = window.innerHeight;
		this._targetX = Math.max(m, Math.min(this._targetX, wW - bW - m));
		this._targetY = Math.max(m, Math.min(this._targetY, wH - bH - m));
	}
	_clampXY(x, y) {
		let m = 5;
		let bW = this._el.offsetWidth;
		let bH = this._el.offsetHeight;
		let wW = window.innerWidth;
		let wH = window.innerHeight;
		return {
			x: Math.max(m, Math.min(x, wW - bW - m)),
			y: Math.max(m, Math.min(y, wH - bH - m))
		};
	}
	_addToQueue(func, scope) {
		if (scope) func = func.bind(scope);
		this._queue.queue(func);
	}
	_speakTTS(text) {
		if (!this._tts || !("speechSynthesis" in window)) return;
		speechSynthesis.cancel();
		const utterance = new SpeechSynthesisUtterance(text.replaceAll("\n", " "));
		utterance.rate = this._tts.rate;
		utterance.pitch = this._tts.pitch;
		const voices = speechSynthesis.getVoices();
		if (voices.length > 0) {
			const match = voices.find((v) => v.name.includes(this._tts.voice));
			if (match) utterance.voice = match;
			speechSynthesis.speak(utterance);
		} else speechSynthesis.addEventListener("voiceschanged", () => {
			const match = speechSynthesis.getVoices().find((voice) => voice.name.includes(this._tts.voice));
			if (match) utterance.voice = match;
			speechSynthesis.speak(utterance);
		}, { once: true });
	}
	dispose() {
		this.stop();
		window.removeEventListener("resize", this._resizeHandle);
		window.clearTimeout(this._dragUpdateLoop);
		window.removeEventListener("mousemove", this._moveHandle);
		window.removeEventListener("mouseup", this._upHandle);
		window.removeEventListener("touchmove", this._moveHandle);
		window.removeEventListener("touchend", this._upHandle);
		this._animator.dispose();
		this._balloon.dispose();
		this._queue.dispose();
		this._el.remove();
	}
	pause() {
		this._animator.pause();
		this._balloon.pause();
	}
	resume() {
		this._animator.resume();
		this._balloon.resume();
	}
};
async function initAgent(loaders) {
	const [{ default: data }, { default: map }, sounds] = await Promise.all([
		loaders.agent(),
		loaders.map(),
		_loadSounds(loaders)
	]);
	return new Agent(map, data, sounds);
}
async function _loadSounds(loaders) {
	const audio = document.createElement("audio");
	if (!(!!audio.canPlayType && audio.canPlayType("audio/mp3") !== "")) return {};
	return (await loaders.sound()).default;
}
export { initAgent };
