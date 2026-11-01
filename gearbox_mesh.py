# gearbox STEP -> one STL per solid (metres), coarse enough for the web
import gmsh, sys, os, json
gmsh.initialize(); gmsh.option.setNumber('General.Terminal', 0)
gmsh.option.setNumber('Geometry.OCCScaling', 0.001)
gmsh.model.occ.importShapes(sys.argv[1]); gmsh.model.occ.synchronize()
vols = gmsh.model.getEntities(3)
print('volumes', len(vols))
x0, y0, z0, x1, y1, z1 = gmsh.model.getBoundingBox(-1, -1)
print('bbox', [round(v, 3) for v in (x0, y0, z0, x1, y1, z1)])
info = []
for d, t in vols:
    b = gmsh.model.getBoundingBox(d, t)
    name = gmsh.model.getEntityName(d, t)
    info.append({'t': t, 'name': name, 'bb': [round(v, 4) for v in b], 'vol': gmsh.model.occ.getMass(d, t)})
json.dump(info, open(os.path.join(sys.argv[2], 'vols.json'), 'w'))
big = sorted(info, key=lambda r: -r['vol'])[:25]
for r in big: print(r['t'], r['name'][:50], r['bb'], round(r['vol'] * 1e6, 1), 'cm3')
gmsh.option.setNumber('Mesh.MeshSizeFromCurvature', 10)
gmsh.option.setNumber('Mesh.MeshSizeMax', 0.02)
gmsh.option.setNumber('Mesh.MeshSizeMin', 0.002)
gmsh.model.mesh.generate(2)
gmsh.option.setNumber('Mesh.SaveAll', 0)
os.makedirs(os.path.join(sys.argv[2], 'parts'), exist_ok=True)
for d, t in vols:
    gmsh.model.removePhysicalGroups()
    gmsh.model.addPhysicalGroup(2, [f[1] for f in gmsh.model.getBoundary([(d, t)], oriented=False)], 1)
    gmsh.write(os.path.join(sys.argv[2], 'parts', f'v{t}.stl'))
gmsh.finalize()
