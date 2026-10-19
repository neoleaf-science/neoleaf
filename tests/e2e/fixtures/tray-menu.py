# Reads the agent's tray item from the D-Bus bus: whether left click opens the menu (ItemIsMenu) and the menu texts.
# Usage: python3 tray-menu.py <service-name>   (prints JSON)
import dbus, json, sys
bus = dbus.SessionBus()
svc = sys.argv[1].split('/')[0]
obj = bus.get_object(svc, '/StatusNotifierItem')
props = dbus.Interface(obj, dbus.PROPERTIES_IFACE)
is_menu = bool(props.Get('org.kde.StatusNotifierItem', 'ItemIsMenu'))
menu_path = str(props.Get('org.kde.StatusNotifierItem', 'Menu'))
menu = dbus.Interface(bus.get_object(svc, menu_path), 'com.canonical.dbusmenu')

def walk(node):
    _id, p, kids = node
    label = str(p.get('label', ''))
    out = {'label': label, 'enabled': bool(p.get('enabled', True)), 'visible': bool(p.get('visible', True)), 'type': str(p.get('type', 'standard'))}
    if kids:
        out['children'] = [walk(k) for k in kids]
    return out

menu.AboutToShow(0)
_rev, layout = menu.GetLayout(0, -1, ['label', 'enabled', 'visible', 'type', 'children-display'])
print(json.dumps({'itemIsMenu': is_menu, 'menu': walk(layout)}))
