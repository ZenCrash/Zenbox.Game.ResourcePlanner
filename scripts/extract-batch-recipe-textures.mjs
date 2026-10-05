import fs from 'node:fs';
import AdmZip from 'adm-zip';
import sharp from 'sharp';
const game=process.argv[2] ?? 'C:/Users/jacob/AppData/Roaming/PrismLauncher/instances/GT New Horizons/minecraft';
const pack=new AdmZip(game+'/resourcepacks/GTNH-Faithful-x32.v2.1.4.zip');
const specs=[
 ['acclimatiser','assets/genetics/textures/gui/nei/acclimatiser.png','binnie-mods-2.5.24.jar',[5,11,166,80]],
 ['analyzer','assets/genetics/textures/gui/nei/analyser.png','binnie-mods-2.5.24.jar',[5,11,166,76]],
 ['calcinator','assets/alchemicalwizardry/gui/nei/calcinator.png','BloodMagic-1.7.52.jar',[5,11,166,50]],
 ['binding','assets/alchemicalwizardry/gui/nei/bindingRitual.png','BloodMagic-1.7.52.jar',[5,11,166,65]],
 ['ender-alloy','assets/enderio/textures/gui/nei/alloySmelter.png','EnderIO-2.9.28.jar',[0,0,166,65]],
 ['animal-trap','assets/harvestcraft/textures/gui/animaltrap.png','harvestcraft-1.3.2-GTNH.jar',[3,8,170,66]],
 ['decayables','assets/miscutils/textures/gui/nei/decayables.png','gregtech-5.09.51.482.jar',[5,11,166,65]],
 ['clarifier','assets/gregtech/textures/gui/progressbar/clarifier.png','gregtech-5.09.51.482.jar',[0,0,170,80]],
];
const sources=[];
for(const [name,source,jar,rect] of specs){const archive=pack.getEntry(source)?pack:new AdmZip(game+'/mods/'+jar);const buffer=archive.readFile(source);const meta=await sharp(buffer).metadata();const scale=meta.width===512?2:1;const [x,y,w,h]=rect;let img=sharp(buffer).extract({left:x*scale,top:y*scale,width:w*scale,height:h*scale}).resize(w*2,h*2,{kernel:'nearest'});const {data,info}=await img.ensureAlpha().raw().toBuffer({resolveWithObject:true});if(name!=='animal-trap')for(let i=0;i<data.length;i+=4)if(data[i]===198&&data[i+1]===198&&data[i+2]===198)data[i+3]=0;await sharp(data,{raw:info}).png().toFile('public/ui/recipe-layouts/'+name+'.png');sources.push({name,source,archive:archive===pack?'GTNH-Faithful-x32.v2.1.4.zip':jar,rect,scale});}
fs.writeFileSync('public/ui/recipe-layouts/batch-sources.json',JSON.stringify(sources,null,2)+'\n');
