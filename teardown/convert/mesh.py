# STEP (CATIA, mm) -> triangle mesh (STL, metres) for the floor
import gmsh, sys
gmsh.initialize()
gmsh.option.setNumber('General.Terminal', 0)
gmsh.option.setNumber('Geometry.OCCScaling', 0.001)        # mm -> m
gmsh.model.occ.importShapes('/mnt/user-data/uploads/Floor.stp')
gmsh.model.occ.synchronize()
ents = gmsh.model.getEntities()
print('entities', {d: sum(1 for e in ents if e[0] == d) for d in range(4)})
xmin, ymin, zmin, xmax, ymax, zmax = gmsh.model.getBoundingBox(-1, -1)
print('bbox m', round(xmin, 3), round(ymin, 3), round(zmin, 3), '->', round(xmax, 3), round(ymax, 3), round(zmax, 3))
# surface mesh only, coarse but faithful to curvature
gmsh.option.setNumber('Mesh.MeshSizeFromCurvature', 12)
gmsh.option.setNumber('Mesh.MeshSizeMax', 0.04)
gmsh.option.setNumber('Mesh.MeshSizeMin', 0.004)
gmsh.option.setNumber('Mesh.Algorithm', 6)
gmsh.model.mesh.generate(2)
types, tags, nodes = gmsh.model.mesh.getElements(2)
print('triangles', sum(len(t) for t in tags))
gmsh.write(sys.argv[1])
gmsh.finalize()
