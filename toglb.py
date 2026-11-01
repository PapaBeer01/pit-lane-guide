import bpy, os
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.stl_import(filepath=os.environ['STL'])
o = bpy.context.selected_objects[0]
o.name = 'floor'
o.scale = (1, 1, 1)   # gmsh already wrote metres
bpy.ops.object.transform_apply(scale=True)
print('verts', len(o.data.vertices), 'dims', tuple(round(d, 3) for d in o.dimensions))
d = o.modifiers.new('dec', 'DECIMATE')
d.ratio = 0.3
bpy.ops.object.modifier_apply(modifier='dec')
bpy.ops.object.shade_auto_smooth(angle=0.6) if hasattr(bpy.ops.object, 'shade_auto_smooth') else None
m = bpy.data.materials.new('carbon_floor')
m.use_nodes = True
bs = m.node_tree.nodes['Principled BSDF']
bs.inputs['Base Color'].default_value = (0.012, 0.013, 0.015, 1)
bs.inputs['Roughness'].default_value = 0.38
bs.inputs['Metallic'].default_value = 0.1
o.data.materials.append(m)
print('tris after', len(o.data.polygons))
bpy.ops.export_scene.gltf(filepath=os.environ['OUT'], export_format='GLB', export_yup=True)
