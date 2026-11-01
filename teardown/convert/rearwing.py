# Rear wing for the web: keep main plane + endplates, top flap (with its edge trims), pylon and actuator; drop the
# 2025 beam wing (banned in 2026), crash structure and rain light. The flap gets its own node, origin on its hinge.
import bpy, os
from mathutils import Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.environ['GLB'])
KEEP_BODY = {'Object_10', 'Object_2', 'Object_14', 'Object_15'}
FLAP = {'Object_3', 'Object_12', 'Object_13'}
for o in list(bpy.context.scene.objects):
    if o.type == 'MESH' and o.name not in KEEP_BODY | FLAP:
        bpy.data.objects.remove(o, do_unlink=True)
# bake all transforms so the parts share one frame
for o in bpy.context.scene.objects:
    o.select_set(o.type == 'MESH')
bpy.context.view_layer.objects.active = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(bpy.context.scene.objects):
    if o.type != 'MESH':
        bpy.data.objects.remove(o, do_unlink=True)
# join the flap pieces into one node
flaps = [o for o in bpy.context.scene.objects if o.name in FLAP]
for o in bpy.context.scene.objects: o.select_set(o in flaps)
bpy.context.view_layer.objects.active = flaps[0]
bpy.ops.object.join()
flap = bpy.context.view_layer.objects.active
flap.name = 'rw_flap'
vs = [flap.matrix_world @ v.co for v in flap.data.vertices]
# Blender axes here: x across, y along the car (rain light was at +y = rear), z up. Leading edge = most forward (min y)
lead = sorted(vs, key=lambda v: v.y)[: max(20, len(vs) // 40)]
piv = Vector((0, sum(v.y for v in lead) / len(lead), sum(v.z for v in lead) / len(lead)))
bpy.context.scene.cursor.location = piv
bpy.context.view_layer.objects.active = flap
for o in bpy.context.scene.objects: o.select_set(o == flap)
bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
body = [o for o in bpy.context.scene.objects if o != flap]
for o in bpy.context.scene.objects: o.select_set(o in body)
bpy.context.view_layer.objects.active = body[0]
bpy.ops.object.join()
bpy.context.view_layer.objects.active.name = 'rw_body'
for o in bpy.context.scene.objects:
    bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
    print(o.name, [round(min(v[i] for v in bb), 2) for i in range(3)], [round(max(v[i] for v in bb), 2) for i in range(3)], len(o.data.polygons))
print('hinge', [round(c, 2) for c in piv])
bpy.ops.export_scene.gltf(filepath=os.environ['OUT'], export_format='GLB', export_yup=True)
