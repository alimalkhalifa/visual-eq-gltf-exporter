const fs = require('fs')
const path = require('path')
const extractTextures = require('./extractors/textures')
const loadS3D = require('./loaders/s3d')
const convertS3D = require('./convertor')

const inDir = './zones'
const outDir = './graphics'

function convertDir(dir, out) {
  try {
    fs.statSync(out)
  } catch(err) {
    console.log("out dir not found")
    fs.mkdirSync(out)
  }
  fs.readdir(dir, async (err, files) => {
    if (err) throw new Error(err)
    let s3dfiles = files.filter(val => val.indexOf('.s3d') !== -1)
    for(let file of s3dfiles) {
      let s3dName = path.basename(file)
      s3dName = s3dName.indexOf('_') !== -1 ? s3dName.substr(0,s3dName.indexOf('_')) : s3dName.substr(0,s3dName.indexOf('.'))
      let type = 'zone'
      if (file.indexOf('_chr') !== -1 || file.indexOf('equip') !== -1) type = 'chr'
      else if (file.indexOf('_obj') !== -1) type = 'obj'
      let outdir
      if (type === "chr") {
        if (s3dName.indexOf('gequip') !== -1) {
          outdir = 'graphics/items'
        } else {
          outdir = 'graphics/characters'
        }
      } else {
        outdir = path.join(out,s3dName)
      }
      try {
        fs.statSync(outdir)
      } catch(err) {
        console.error('out dir not found')
        fs.mkdirSync(outdir)
      }
      let s3d = loadS3D(path.join(dir, file), file === 'gequip.s3d')
      await extractTextures(s3dName, type, s3d, outdir).then(value => {
        console.log('done extracting textures')
      })
      await convertS3D(s3dName, type, s3d, outdir)
    }
    fs.readdir(out, async (err, files) => {
      if (err) throw new Error(err)
      let zones = []
      for (let f of files) {
        if (f !== "characters" && f !== "items" && f !== ".keep") {
          zones.push(f)
        }
      }
      fs.writeFileSync(`${out}/zones.json`, JSON.stringify({zones}))
      fs.readdir(`${out}/characters`, async (err, files) => {
        if (err) throw new Error(err)
        let races = []
        for (let f of files.filter(value => value.indexOf('.glb') !== -1)) {
          races.push(path.basename(f, '.glb'))
        }
        fs.writeFileSync(`${out}/characters/races.json`, JSON.stringify({races}))
        fs.readdir(`${out}/items`, async (err, files) => {
          if (err) throw new Error(err)
          let items = []
          for (let f of files.filter(value => value.indexOf('.glb') !== -1)) {
            items.push(path.basename(f, '.glb'))
          }
          fs.writeFileSync(`${out}/items/items.json`, JSON.stringify({items}))
        })
      })
    })
  })
}

convertDir(inDir, outDir)