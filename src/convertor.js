const fs = require('fs')
const path = require('path')
const THREE = require('three')
const GLTFExporter = require('./extractors/gltf')
const loadWLD = require('./loaders/wld')
const loadMesh = require('./loaders/mesh')
const { promisify } = require('util')

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
  console.log(`Extracting ${zoneName}.s3d`)
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
  await convertToGltf(scene, out, zoneName, 0)
}

async function convertObjToglTFs(zoneName, s3d, out) {
  console.log(`Extracting ${zoneName}_obj.s3d`)
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
  await convertToGltf(scene, out, zoneName, 1)
}

async function convertChrToglTFs(zoneName, s3d, out) {
  console.log(`Extracting ${zoneName}_chr.s3d`)
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
      let data = await convertToGltf(scene, out, raceCode, 2)
      if (data) exportCharModelSpecs(raceCode, data, out)
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

async function convertToGltf(scene, out, zoneName, type) {
  return await new Promise((resolve, reject) => {
    const exporter = new GLTFExporter()
    exporter.parse(scene, gltf => {
      if (gltf instanceof ArrayBuffer) {
        fs.writeFileSync(`${out}/${zoneName}${type === 2 ? '_chr' : type === 1 ? '_obj' : ''}.glb`, Buffer.from(gltf))
        resolve(gltf)
      } else {
        reject(`${zoneName} has no data`)
      }
    }, {
      embedImages: false,
      binary: true
    })
  }).catch(err => {
    console.error(err)
  })
}

async function exportCharModelSpecs(raceCode, data, out) {
  console.log(`Exporting ${raceCode} Model Specs`)
  try {
    let files = fs.readdirSync(path.join(out, 'textures'))
    const buf = Buffer.from(data)
    const jsonBufSize = buf.readUInt32LE(12)
    const jsonString = buf.toString('utf8', 20, jsonBufSize + 20)
    const gltf = JSON.parse(jsonString)
    const images = gltf.images
    const imgs = images.map(img => {
      return path.basename(img.uri)
    })
    let maxHelm = 0
    let maxBody = 0
    let bodyImage
    gltf.nodes.forEach(node => {
      if (node.name.substr(3, 2) === "HE") {
        if (parseInt(node.name.substr(5, 2)) > maxHelm) {
          maxHelm = parseInt(node.name.substr(5, 2))
        }
      } else if (node.name.substr(3, 1) === "0") {
        bodyImage = imgs[gltf.materials[gltf.meshes[node.mesh].primitives[0].material].pbrMetallicRoughness.baseColorTexture.index]
        if (parseInt(node.name.substr(3, 2)) > maxBody) {
          maxBody = parseInt(node.name.substr(3, 2))
        }
      }
    })
    let imageSpecs = {}
    imgs.forEach(img => {
      let raceFile = img.indexOf(raceCode.toLowerCase()) !== -1
      let alpha = img.indexOf('alpha') !== -1
      let partFiles = files.filter(value => value.substr(0, raceFile ? 5 : 3) == img.substr(0, raceFile ? 5 : 3) && value.substr(alpha ? value.length - 11 : value.length - 5, 1) === img.substr(alpha ? img.length - 11 : img.length - 5, 1) && (alpha ? value.indexOf('alpha') !== -1 : value.indexOf('alpha') === -1))
      let maxTexture = 0
      let maxFace = 0
      partFiles.forEach(file => {
        let startNumbers = partFiles[0].search(/[0-9]/)
        let texture = parseInt(file.substr(startNumbers < 0 ? 0 : startNumbers, 2))
        if (!isNaN(texture) && texture > maxTexture) {
          maxTexture = texture
        }
        if (img.substr(3, 2) === "he" && parseInt(file.substr(7, 1)) > maxFace) {
          maxFace = parseInt(file.substr(7, 1))
        }
      })
      imageSpecs[img] = {
        ...(img.substr(3,2) === "he" ? {maxFace} : {}),
        maxTexture
      }
    })
    let keys = Object.keys(imageSpecs)
    let basePart = keys.filter(value => value.indexOf(raceCode.toLowerCase()) !== -1 && value.indexOf('he', 3) === -1)[0]
    if (!basePart) basePart = keys[0]
    let baseHead = keys.filter(value => value.indexOf(raceCode.toLowerCase()) !== -1 && value.indexOf('he', 3) !== -1)[0]
    let modelSpec = {
      maxFace: baseHead ? imageSpecs[baseHead].maxFace : 0,
      maxHelm,
      maxTexture: keys.length > 0 ? basePart ? imageSpecs[basePart].maxTexture : imageSpecs[0].maxTexture : 0,
      maxBodyTexture: bodyImage ? imageSpecs[bodyImage].maxTexture + 6 : 0,
      maxBody,
      imageSpecs
    }
    fs.writeFileSync(`${out}/${raceCode}.json`, JSON.stringify(modelSpec))
  } catch(err) {
    throw new Error(err)
  }
}
