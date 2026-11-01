# Mesh the front wing by CAD surface groups: the body, and each flap half (flap 1 = upper-front, flap 2 = top-rear)
import gmsh, sys, os
gmsh.initialize(); gmsh.option.setNumber('General.Terminal', 0)
gmsh.option.setNumber('Geometry.OCCScaling', 0.001)
gmsh.model.occ.importShapes(sys.argv[1]); gmsh.model.occ.synchronize()
F1 = {9, 11, 12}, {10, 14, 15}
F2 = {17, 18, 19}, {20, 21, 22}
# which side each is on, from their bounding boxes
side = lambda s: 'L' if gmsh.model.getBoundingBox(2, sorted(s)[0])[4] > 0.01 else 'R'
groups = {}
for name, pair in (('flap1', F1), ('flap2', F2)):
    for s in pair:
        groups[f'{name}{side(s)}'] = sorted(s)
used = {t for v in groups.values() for t in v}
groups['body'] = [t for _, t in gmsh.model.getEntities(2) if t not in used]
gmsh.option.setNumber('Mesh.MeshSizeFromCurvature', 14)
gmsh.option.setNumber('Mesh.MeshSizeMax', 0.03)
gmsh.option.setNumber('Mesh.MeshSizeMin', 0.002)
gmsh.model.mesh.generate(2)
gmsh.option.setNumber('Mesh.SaveAll', 0)
for i, (n, faces) in enumerate(groups.items()):
    gmsh.model.removePhysicalGroups()
    gmsh.model.addPhysicalGroup(2, faces, i + 1)
    gmsh.write(os.path.join(sys.argv[2], f'{n}.stl'))
    print(n, len(faces))
gmsh.finalize()
