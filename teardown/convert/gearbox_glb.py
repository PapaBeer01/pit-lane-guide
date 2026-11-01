# Gearbox parts -> glTF: 'gb_case' (the big housing) and 'gb_internals' (shafts, gears, barrel, bearings), decimated
import bpy, os, glob, json
bpy.ops.wm.read_factory_settings(use_empty=True)
P = os.environ['DIR']
info = {r['t']: r for r in json.load(open(os.path.join(P, 'vols.json')))}
def mat(n, rgb, metal, rough):
    m = bpy.data.materials.new(n); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Metallic'].default_value = metal; b.inputs['Roughness'].default_value = rough
    return m
case_m = mat('gb_case', (0.08, 0.085, 0.095), 0.7, 0.4)
steel = mat('gb_steel', (0.55, 0.57, 0.6), 1.0, 0.32)
alu = mat('gb_alu', (0.75, 0.77, 0.8), 1.0, 0.38)
objs = []
for f in sorted(glob.glob(os.path.join(P, 'parts', '*.stl'))):
    t = int(os.path.basename(f)[1:-4])
    if t == 159:
        continue   # the display stand, not part of the gearbox
    bpy.ops.wm.stl_import(filepath=f)
    o = bpy.context.selected_objects[0]
    v = info[t]['vol'] * 1e6
    o.name = f'v{t}'
    o.data.materials.append(case_m if t == 159 else steel if v > 20 else alu)
    objs.append((o, t))
tot = sum(len(o.data.polygons) for o, _ in objs)
print('total tris before', tot)
ratio = min(1.0, 120000 / tot)
for o, t in objs:
    bpy.context.view_layer.objects.active = o
    d = o.modifiers.new('dec', 'DECIMATE'); d.ratio = ratio
    bpy.ops.object.modifier_apply(modifier='dec')
for name, keep in (('gb_internals', lambda t: True),):
    sel = [o for o, t in objs if keep(t)]
    for o in bpy.context.scene.objects: o.select_set(o in sel)
    bpy.context.view_layer.objects.active = sel[0]
    bpy.ops.object.join()
    bpy.context.view_layer.objects.active.name = name
print('total tris after', sum(len(o.data.polygons) for o in bpy.context.scene.objects))
bpy.ops.export_scene.gltf(filepath=os.environ['OUT'], export_format='GLB', export_yup=True)
