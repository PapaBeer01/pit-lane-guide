# Convert the 2026-style power unit .blend into a light glTF for the web:
#  - no bolts, logo text, reference images or helper planes
#  - Blender's procedural materials become plain PBR values the web can show (carbon, anodised metal, steel, plastics)
#  - one parent node per system (collection) so the site can pull systems apart: sys_<collection>
import bpy, os, re
bpy.ops.wm.open_mainfile(filepath=os.environ['BLEND'])
D = bpy.data
SKIP = re.compile(r'(bolt|screw|logo|text|emmiter|ground|mirror_plane|hexagon_example)', re.I)
for o in list(D.objects):
    col = o.users_collection[0].name if o.users_collection else ''
    if o.type in ('CAMERA', 'LIGHT', 'GREASEPENCIL', 'GPENCIL', 'EMPTY') or SKIP.search(o.name) or col == 'images':
        D.objects.remove(o, do_unlink=True)
for o in D.objects:
    for m in o.modifiers:
        if m.type == 'SUBSURF':
            m.levels = min(m.levels, 1)
# web materials: (base colour, metallic, roughness)
LOOK = [
    (r'^Carbon', ('#1d1e22', 0.15, 0.32)),
    (r'^Anodized Metal_grey', ('#6c7179', 0.85, 0.34)),
    (r'^Anodized Metal_silver', ('#c4c9cf', 0.9, 0.28)),
    (r'^Anodized Metal', ('#2b2d33', 0.85, 0.32)),
    (r'Brushed Steel', ('#b7bcc3', 1.0, 0.33)),
    (r'chrome', ('#e1e4e8', 1.0, 0.12)),
    (r'^Steel', ('#9aa0a7', 1.0, 0.38)),
    (r'Plastic_black', ('#17181a', 0.0, 0.5)),
    (r'Plastic_blue', ('#2a6fd6', 0.0, 0.42)),
    (r'plastic_dark_red', ('#8e1b1b', 0.0, 0.45)),
    (r'plastic_light_blue', ('#6fb6e8', 0.0, 0.42)),
    (r'Plastic_orange', ('#e8761c', 0.0, 0.42)),
    (r'plastic_red', ('#d42a2a', 0.0, 0.42)),
    (r'Plastic_yellow', ('#f2c21b', 0.0, 0.42)),
    (r'Rubber', ('#1a1a1a', 0.0, 0.9)),
]
def rgb(h):
    h = h.lstrip('#')
    return [((int(h[i:i + 2], 16) / 255) ** 2.2) for i in (0, 2, 4)] + [1]
for m in D.materials:
    if not m.use_nodes or 'stickers' in m.name or 'Braided' in m.name:
        continue
    look = next((v for k, v in LOOK if re.search(k, m.name, re.I)), None)
    if not look:
        continue
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bs = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bs.inputs['Base Color'].default_value = rgb(look[0])
    bs.inputs['Metallic'].default_value = look[1]
    bs.inputs['Roughness'].default_value = look[2]
    nt.links.new(bs.outputs['BSDF'], out.inputs['Surface'])
# a parent per system
groups = {}
for o in list(D.objects):
    if o.parent or o.type not in ('MESH', 'CURVE'):
        continue
    col = o.users_collection[0].name if o.users_collection else 'misc'
    if col not in groups:
        e = D.objects.new('sys_' + col, None)
        bpy.context.scene.collection.objects.link(e)
        groups[col] = e
    mw = o.matrix_world.copy()
    o.parent = groups[col]
    o.matrix_world = mw
print('systems', sorted(groups))
bpy.ops.export_scene.gltf(filepath=os.environ['OUT'], export_format='GLB', export_apply=True, use_visible=False,
                          export_yup=True, export_materials='EXPORT', export_image_format='AUTO')
