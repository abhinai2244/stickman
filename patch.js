const fs = require('fs');

let code = fs.readFileSync('index.html', 'utf8');

// 1. Dynamic Platforms
code = code.replace(/C\.PL:\s*\{[^}]+\},?\s*/g, '');
code = code.replace(/C\.PR:\s*\{[^}]+\},?\s*/g, '');
code = code.replace(/let cv, ctx, scale = 1, offX = 0, offY = 0;/, "let cv, ctx, scale = 1, offX = 0, offY = 0;\nlet leftPlat = { x: 55, y: 305, w: 165, h: 310 };\nlet rightPlat = { x: 775, y: 365, w: 165, h: 250 };");
code = code.replace(/C\.PL/g, 'leftPlat');
code = code.replace(/C\.PR/g, 'rightPlat');

// In startRound, randomize platforms
code = code.replace(/const pl0=leftPlat, pl1=rightPlat;/, `
  // Randomize platforms
  leftPlat = { x: randInt(20, 80), y: randInt(280, 480), w: randInt(140, 190), h: 600 };
  rightPlat = { x: C.W - randInt(20, 80) - randInt(140, 190), y: randInt(280, 480), w: randInt(140, 190), h: 600 };
  const pl0=leftPlat, pl1=rightPlat;
`);

// 2. Fix Ragdoll Drawing
// Update Stickman.die to pass this.severed
code = code.replace(/this\.ragdoll=new VRagdoll\(j,this\.headR\);/, 'this.ragdoll=new VRagdoll(j,this.headR,this.severed);');

// Update VRagdoll constructor
code = code.replace(/constructor\(joints, headR\) \{/, 'constructor(joints, headR, severed) {\n    this.severed = severed || new Set();');

// Update drawRagdoll
code = code.replace(/function drawRagdoll\(rd\) \{[\s\S]*?ctx\.lineWidth=4;ctx\.beginPath\(\);ctx\.moveTo\(0,0\);ctx\.lineTo\(this\.len,0\);ctx\.stroke\(\);/, (match) => {
  // Let's just manually replace drawRagdoll with a clean version
  return `function drawRagdoll(rd) {
  const p=rd.pts; const col=C.STK; const sv=rd.severed;
  ctx.strokeStyle=col;ctx.fillStyle=col;ctx.lineCap='round';
  const line=(a,b,w)=>{
    if(!p[a]||!p[b])return;
    ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(p[a].x,p[a].y);ctx.lineTo(p[b].x,p[b].y);ctx.stroke();
  };
  if(!sv.has('legB')){line('hip','kneeB',4);line('kneeB','footB',4);}
  if(!sv.has('armB')){line('shoulder','elbowB',3.5);line('elbowB','handB',3.5);}
  line('shoulder','hip',5);
  if(!sv.has('head')){
    line('head','shoulder',3);
    if(p.head){ctx.beginPath();ctx.arc(p.head.x,p.head.y,rd.headR,0,6.28);ctx.fill();}
  } else {
    // Draw stump
    ctx.beginPath();ctx.arc(p.shoulder.x,p.shoulder.y-4,4,0,6.28);ctx.fillStyle='#8b0000';ctx.fill();
    ctx.fillStyle=col; // restore
  }
  if(!sv.has('legF')){line('hip','kneeF',4.5);line('kneeF','footF',4.5);}
  if(!sv.has('armF')){line('shoulder','elbowF',4);line('elbowF','handF',4);}
}

// Draw method of SeveredPart starts below
// (Replacing old drawRagdoll text, so we need to ensure we didn't wipe anything. Let's not use regex this complex)
`;
});

fs.writeFileSync('patch.js', '/* Done */');
