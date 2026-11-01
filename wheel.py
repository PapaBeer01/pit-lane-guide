# Convert the F1 steering wheel .blend for the web: no team logo, no team dashboard picture (the site draws its own
# live screen on the 'live_screen' plane), plain PBR materials for Blender's procedural ones, simplified later.
import bpy, os, re
bpy.ops.wm.open_mainfile(filepath=os.environ['BLEND'])
D = bpy.data
for o in list(D.objects):
    if o.type in ('CAMERA', 'LIGHT') or re.search(r'(ferrari|ground)', o.name, re.I):
        D.objects.remove(o, do_unlink=True)
LOOK = [
    (r'Carbon', ('#1b1c20', 0.15, 0.3)),
    (r'AnodizedMetal_grey', ('#6c7179', 0.85, 0.34)),
    (r'Brass', ('#b58a3c', 1.0, 0.3)),
    (r'Black plastic|mat_Plastic', ('#141517', 0.0, 0.5)),
    (r'plastic_white', ('#e9eaec', 0.0, 0.45)),
    (r'Rubber', ('#1c1c1e', 0.0, 0.85)),
    (r'Translucent Plastic_blue', ('#2f7fd8', 0.0, 0.3)),
    (r'Translucent Plastic_green', ('#22b35b', 0.0, 0.3)),
    (r'Translucent Plastic_red', ('#e0322f', 0.0, 0.3)),
    (r'Translucent Plastic_yellow', ('#f3c21c', 0.0, 0.3)),
    (r'glass', ('#0b0c0e', 0.0, 0.05)),
    (r'display_screen', ('#050607', 0.0, 0.3)),
]
def rgb(h):
    h = h.lstrip('#')
    return [((int(h[i:i + 2], 16) / 255) ** 2.2) for i in (0, 2, 4)] + [1]
for m in D.materials:
    if not m.use_nodes or 'stickers' in m.name:
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
scr = D.objects.get('steering_wheel_display_emmiter.001')
if scr:
    scr.name = 'live_screen'
    mat = D.materials.new('live_screen')
    scr.data.materials.clear()
    scr.data.materials.append(mat)
for o in D.objects:
    print(o.type, o.name, [m.name for m in getattr(o.data, 'materials', [])][:3] if o.type == 'MESH' else '')
bpy.ops.export_scene.gltf(filepath=os.environ['OUT'], export_format='GLB', export_apply=True, use_visible=False,
                          export_yup=True, export_materials='EXPORT', export_image_format='AUTO')
