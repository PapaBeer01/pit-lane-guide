# Body + four flap halves -> one glTF. Each flap is re-centred on a hinge along its own leading edge (inner to outer
# point), stored in the node's extras as the axis, so the site can turn it about the real hinge line.
import bpy, os, json
from mathutils import Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
D = os.environ['DIR']
def mat(name, rgb):
    m = bpy.data.materials.new(name); m.use_nodes = True
    bs = m.node_tree.nodes['Principled BSDF']; bs.inputs['Base Color'].default_value = (*rgb, 1); bs.inputs['Roughness'].default_value = 0.35
    return m
carbon = mat('wing_carbon', (0.012, 0.013, 0.015))
flapm = mat('wing_flap', (0.016, 0.017, 0.022))
for n, ratio in (('body', 0.18), ('flap1L', 0.35), ('flap1R', 0.35), ('flap2L', 0.35), ('flap2R', 0.35)):
    bpy.ops.wm.stl_import(filepath=os.path.join(D, n + '.stl'))
    o = bpy.context.selected_objects[0]; o.name = 'fw_' + n
    bpy.context.view_layer.objects.active = o
    d = o.modifiers.new('dec', 'DECIMATE'); d.ratio = ratio; bpy.ops.object.modifier_apply(modifier='dec')
    o.data.materials.append(carbon if n == 'body' else flapm)
    if n != 'body':
        vs = [o.matrix_world @ v.co for v in o.data.vertices]
        ay = sorted(vs, key=lambda v: abs(v.y))
        k = max(5, len(vs) // 30)
        inner = min(ay[:k * 3], key=lambda v: v.x)       # most forward point near the inner end
        outer = min(ay[-k * 3:], key=lambda v: v.x)      # ... and near the outer end
        piv = inner
        # move the origin to the hinge point
        bpy.context.scene.cursor.location = piv
        bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
        ax = (outer - inner).normalized()
        # glTF is y-up: Blender (x, y, z) -> glTF (x, z, -y)
        o['hinge_axis'] = [ax.x, ax.z, -ax.y]
        print(n, 'hinge', [round(c, 3) for c in piv], 'axis', [round(c, 3) for c in ax])
    print(n, 'tris', len(o.data.polygons))
bpy.ops.export_scene.gltf(filepath=os.environ['OUT'], export_format='GLB', export_yup=True, export_extras=True)
