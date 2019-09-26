const THREE = require('three')
const GLTFExporter = require('./extractors/gltf')
const loadWLD = require('./loaders/wld')
const loadMesh = require('./loaders/mesh')

module.exports = async function convertS3D(s3dName, type, s3d, out) {
  if (type === "chr") {
    if (s3dName.indexOf('gequip') !== -1) {
      out = 'graphics/items'
    } else {
      out = 'graphics/characters'
    }
  }
  switch(type) {
    case 'zone':
      await convertZoneToglTF(s3dName, s3d, out)
      break
    case 'chr':
      await convertChrToglTFs(s3dName, s3d, out)
      break
    case 'obj':
      await convertObjToglTFs(s3dName, s3d, out)
      break
    default:
      throw new Error('Unknown S3D type')
  }
}

async function convertZoneToglTF(zoneName, s3d, out) {
  parentPort.postMessage({type: "log", message: `Converting ${zoneName}`})
  let wld = s3d.files[`${zoneName}.wld`]
  let obj = s3d.files['objects.wld']
  let zone = loadWLD(wld)
  let objects = loadWLD(obj)
  let scene = new THREE.Scene()
  let materialCache = {}
  let imageCache = {}
  for (let fragIndex in zone) {
    let fragment = zone[fragIndex]
    if (fragment.type === "Mesh") {
      let mesh = loadMesh(fragment, zone, materialCache, imageCache)
      scene.add(mesh)
    }
  }
  let objectLocations = []
  for (let fragIndex in objects) {
    let fragment = objects[fragIndex]
    if (fragment.type === "ObjectLocation") {
      objectLocations.push({
        name: fragment.ref,
        position: [
          fragment.x,
          fragment.y,
          fragment.z
        ],
        scale: [
          fragment.scaleX,
          fragment.scaleX,
          fragment.scaleY,
        ],
        rot: [
          THREE.Math.degToRad(fragment.rotX / (512/360)),
          THREE.Math.degToRad(fragment.rotY / (512/360)),
          THREE.Math.degToRad(fragment.rotZ / (512/360))
        ]
      })
    }
  }
  scene.userData.objectLocations = objectLocations
  const exporter = new GLTFExporter()
  await exporter.parse(scene, gltf => {
    fs.writeFileSync(`${out}/${zoneName}.glb`, Buffer.from(gltf))
  }, {
    embedImages: false,
    binary: true
  })
}

async function convertObjToglTFs(zoneName, s3d, out) {
  parentPort.postMessage({type: "log", message: `Converting ${zoneName}_obj`})
  let wld = s3d.files[`${zoneName}_obj.wld`]
  let zone = loadWLD(wld)
  let scene = new THREE.Scene()
  let materialCache = {}
  let imageCache = {}
  for (let fragIndex in zone) {
    let fragment = zone[fragIndex]
    if (fragment.type === "StaticModelRef") {
      let meshRef = fragment.meshReferences[0]
      let meshInfo = zone[zone[meshRef].mesh]
      if (meshInfo) {
        let mesh = loadMesh(meshInfo, zone, materialCache, imageCache)
        mesh.name = fragment.name
        scene.add(mesh)
      }
    }
  }
  const exporter = new GLTFExporter()
  await exporter.parse(scene, gltf => {
    fs.writeFileSync(`${out}/${zoneName}_obj.glb`, Buffer.from(gltf))
  }, {
    embedImages: false,
    binary: true
  })
}

async function convertChrToglTFs(zoneName, s3d, out) {
  parentPort.postMessage({type: "log", message: `Converting ${zoneName}_chr`})
  let wld = zoneName.indexOf('gequip') !== -1 ? s3d.files[`${zoneName}.wld`] : s3d.files[`${zoneName}_chr.wld`]
  let zone = loadWLD(wld)
  let zoneKeys = Object.keys(zone)
  let materialCache = {}
  let imageCache = {}
  let meshes = []
  for (let fragIndex in zone) {
    let fragment = zone[fragIndex]
    let mesh0
    if (fragment.type === "StaticModelRef") {
      let raceCode = fragment.name.substr(0, fragment.name.indexOf('_'))
      mesh0 = zone[fragment.meshReferences[0]]
      let entries = []
      if (mesh0.type === "SkeletonTrackRef") {
        
      }
      let scene = new THREE.Scene()
      if (mesh0.type === "SkeletonTrackRef") {
        let skeletonFragment = zone[fragment.meshReferences[0]] && zone[fragment.meshReferences[0]].skeletonTrack && zone[zone[fragment.meshReferences[0]].skeletonTrack]
        entries = skeletonFragment && skeletonFragment.entries
        if (entries.length > 0) {
          let stem = entries[0]
          walkSkeleton(zone, entries, stem)
        }
        let group = new THREE.Group()
        group.name = raceCode
        let rootName =  zone[mesh0.skeletonTrack].name.substr(0, zone[mesh0.skeletonTrack].name.indexOf('_'))
        for (let fragIndex2 in zone) {
          let f = zone[fragIndex2]
          if (f && f.type === "Mesh" && meshes.indexOf(f) === -1) meshes.push(f) // debug
          if (f && f.type === "Mesh" && (f.name.indexOf(raceCode) !== -1 || f.name.indexOf(rootName) !== -1)) {
            let helmchr = f.name.substr(3, f.name.indexOf('_') - 3)
            let helm = helmchr.length == 0 ? "BASE" : helmchr.indexOf("HE") !== -1 ? helmchr : `BO${helmchr}`
            let mesh =  loadMesh(f, zone, materialCache, imageCache, entries)
            mesh.userData.helm = helm
            group.add(mesh)
          }
        }
        scene.add(group)
      } else if (mesh0.type === "MeshRef") {
        let mesh = loadMesh(zone[mesh0.mesh], zone, materialCache, imageCache)
        scene.add(mesh)
      }
      const exporter = new GLTFExporter()
      await exporter.parse(scene, gltf => {
        if (gltf instanceof ArrayBuffer) {
          let data
          try {
            data = Buffer.from(gltf)
          } catch(err) {
            throw new Error(err)
          }
          fs.writeFileSync(`${out}/${raceCode}.glb`, Buffer.from(gltf))
        }
      }, {
        embedImages: false,
        binary: true
      })
    }
  }
}

function walkSkeleton(chr, entries, bone, parentShift = new THREE.Vector3(), parentRot = new THREE.Euler(0, 0, 0, 'YXZ')) {
  let pieceRef = chr[bone.Fragment1]
  let piece = chr[pieceRef.skeletonPieceTrack]
  piece.shift = new THREE.Vector3(piece.shiftX[0], piece.shiftY[0], piece.shiftZ[0]).divideScalar(piece.shiftDenominator[0])
  piece.shift.applyEuler(parentRot)
  piece.shift.add(parentShift)
  let rotVector = new THREE.Vector3(piece.rotateX[0], piece.rotateY[0], piece.rotateZ[0]).divideScalar(piece.rotateDenominator).multiplyScalar(Math.PI / 2)
  rotVector.add(parentRot.toVector3())
  piece.rot = new THREE.Euler().setFromVector3(rotVector, 'YXZ')
  for (let b of bone.Data) {
    walkSkeleton(
      chr,
      entries,
      entries[b],
      piece.shift,
      piece.rot
    )
  }
}

