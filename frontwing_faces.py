import gmsh, sys
gmsh.initialize(); gmsh.option.setNumber('General.Terminal', 0)
gmsh.option.setNumber('Geometry.OCCScaling', 0.001)
gmsh.model.occ.importShapes(sys.argv[1]); gmsh.model.occ.synchronize()
rows = []
for d, t in gmsh.model.getEntities(2):
    b = gmsh.model.getBoundingBox(2, t)
    m = gmsh.model.occ.getMass(2, t)
    rows.append((t, b, m))
# wide, low, behind the leading edge: candidate wing elements
for t, b, m in sorted(rows, key=lambda r: -(r[1][4] - r[1][1])):
    x0, y0, z0, x1, y1, z1 = b
    if (y1 - y0) > 0.25 and z1 < 0.35:
        print(f'{t:4d} x[{x0:6.3f},{x1:6.3f}] y[{y0:6.3f},{y1:6.3f}] z[{z0:6.3f},{z1:6.3f}] area={m:.4f}')
gmsh.finalize()
