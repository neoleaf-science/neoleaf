# Fake tray (StatusNotifierWatcher) to test the agent icon on a private D-Bus bus.
# Usage: python3 fake-sni-watcher.py file.json   (SIGUSR1 makes the watcher "forget" the items)
import dbus, dbus.service, dbus.mainloop.glib, sys, os, json, signal
from gi.repository import GLib
dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
LOG = sys.argv[1]
class Watcher(dbus.service.Object):
    def __init__(self, bus):
        self.items = []
        self.regs = 0
        dbus.service.Object.__init__(self, bus, '/StatusNotifierWatcher')
    @dbus.service.method('org.kde.StatusNotifierWatcher', in_signature='s', out_signature='')
    def RegisterStatusNotifierItem(self, service):
        self.regs += 1
        self.items.append(str(service))
        self.write()
    @dbus.service.method('org.kde.StatusNotifierWatcher', in_signature='s', out_signature='')
    def RegisterStatusNotifierHost(self, service): pass
    @dbus.service.method(dbus.PROPERTIES_IFACE, in_signature='ss', out_signature='v')
    def Get(self, iface, prop):
        if prop == 'RegisteredStatusNotifierItems': return dbus.Array(self.items, signature='s')
        if prop == 'IsStatusNotifierHostRegistered': return dbus.Boolean(True)
        if prop == 'ProtocolVersion': return dbus.Int32(0)
        raise dbus.exceptions.DBusException('no such property')
    @dbus.service.method(dbus.PROPERTIES_IFACE, in_signature='s', out_signature='a{sv}')
    def GetAll(self, iface):
        return {'RegisteredStatusNotifierItems': dbus.Array(self.items, signature='s'), 'IsStatusNotifierHostRegistered': dbus.Boolean(True), 'ProtocolVersion': dbus.Int32(0)}
    def write(self):
        open(LOG, 'w').write(json.dumps({'regs': self.regs, 'items': self.items}))
bus = dbus.SessionBus()
name = dbus.service.BusName('org.kde.StatusNotifierWatcher', bus)
w = Watcher(bus)
w.write()
# SIGUSR1: the watcher "forgets" the items (simulates a tray that lost the icon)
def forget(*a):
    w.items = []; w.write(); return True
GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGUSR1, forget)  # noqa
GLib.MainLoop().run()
