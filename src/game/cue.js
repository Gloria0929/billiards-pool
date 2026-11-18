import * as THREE from "three";
import { surfaceColor } from "./table-materials.js";

function woodGrain() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ead7ad";
  ctx.fillRect(0, 0, 256, 1024);
  for (let i = 0; i < 110; i++) {
    const x = (i * 37.71) % 256;
    ctx.strokeStyle = `rgba(98, 62, 28, ${0.025 + (i % 7) * 0.009})`;
    ctx.lineWidth = 0.45 + (i % 4) * 0.3;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    for (let y = 0; y <= 1024; y += 32)
      ctx.lineTo(x + Math.sin(y / 230 + i * 1.7) * (1.5 + (i % 6)), y);
    ctx.stroke();
  }
  const map = new THREE.CanvasTexture(canvas);
  map.encoding = THREE.sRGBEncoding;
  return map;
}

function linenWrap() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#24241f";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = -256; i < 512; i += 4) {
    ctx.strokeStyle = i % 8 === 0 ? "#57564a" : "#151611";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 256, 256);
    ctx.stroke();
  }
  const map = new THREE.CanvasTexture(canvas);
  map.encoding = THREE.sRGBEncoding;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(2, 8);
  return map;
}

// A 1470 mm cue, with its rounded tip at the local origin and its butt along -Y.
export function createCue() {
  const cue = new THREE.Group();
  cue.name = "Maple and ebony cue";
  const grain = woodGrain();
  const material = (color, roughness, metalness = 0) =>
    new THREE.MeshStandardMaterial({
      color: surfaceColor(color),
      roughness,
      metalness,
    });
  const shaft = new THREE.MeshPhysicalMaterial({
    map: grain,
    roughness: 0.34,
    clearcoat: 0.3,
    clearcoatRoughness: 0.36,
  });
  const ebony = new THREE.MeshPhysicalMaterial({
    color: surfaceColor(0x322416),
    map: grain,
    roughness: 0.27,
    clearcoat: 0.7,
    clearcoatRoughness: 0.22,
  });
  const ivory = material(0xe2d8bb, 0.37);
  const black = material(0x181815, 0.36);
  const silver = material(0xaaa79d, 0.25, 0.85);
  const brass = material(0x9f7c44, 0.29, 0.65);
  const grip = new THREE.MeshStandardMaterial({
    map: linenWrap(),
    roughness: 0.86,
    bumpScale: 0.09,
  });
  grip.bumpMap = grip.map;
  const section = (name, start, length, nearRadius, farRadius, surface) => {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(nearRadius, farRadius, length, 32),
      surface,
    );
    mesh.name = name;
    mesh.position.y = -start - length / 2;
    cue.add(mesh);
    return mesh;
  };

  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(
      6.5,
      32,
      12,
      0,
      Math.PI * 2,
      0,
      Math.acos(1 - 3 / 6.5),
    ),
    material(0x648b87, 0.94),
  );
  tip.name = "Chalked leather tip";
  tip.position.y = -6.5;
  cue.add(tip);
  section("Leather tip layers", 3, 4, 5.48, 5.6, material(0x373526, 0.82));
  section("Ferrule", 7, 18, 5.6, 5.7, ivory);
  section("Maple shaft", 25, 735, 5.7, 10.5, shaft);
  section("Joint collar", 760, 6, 10.5, 10.65, black);
  section("Steel joint", 766, 8, 10.65, 10.72, silver);
  section("Joint trim", 774, 2, 10.72, 10.75, black);
  section("Ebony forearm", 776, 294, 10.75, 13.1, ebony);
  section("Forearm ring", 1067, 3, 13.2, 13.2, brass);
  section("Linen grip", 1070, 300, 13.1, 14.6, grip);
  section("Grip ring", 1370, 3, 14.7, 14.7, brass);
  section("Butt sleeve", 1373, 77, 14.6, 15, ebony);
  section("Butt cap", 1450, 10, 15, 15, ivory);
  section("Rubber bumper", 1460, 10, 15, 14, material(0x151612, 0.95));

  // Four slim maple points follow the forearm's tapered surface.
  for (let point = 0; point < 4; point++) {
    const positions = [],
      indices = [];
    const angle = (point * Math.PI) / 2 + Math.PI / 4;
    for (let row = 0; row <= 16; row++) {
      const t = row / 16;
      const y = 805 + t * 245;
      const radius = 10.75 + ((y - 776) / 294) * (13.1 - 10.75) + 0.04;
      for (const side of [-1, 1]) {
        const a = angle + side * t * 0.27;
        positions.push(Math.cos(a) * radius, -y, Math.sin(a) * radius);
      }
      if (row < 16) {
        const i = row * 2;
        indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const inlay = new THREE.Mesh(geometry, shaft);
    inlay.name = "Maple forearm point";
    cue.add(inlay);
  }
  return cue;
}
