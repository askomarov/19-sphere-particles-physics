import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Inspector } from "three/addons/inspector/Inspector.js";
import { bloom } from "three/examples/jsm/tsl/display/BloomNode.js";
import {
  bufferAttribute,
  color,
  cos,
  deltaTime,
  dot,
  EPSILON,
  float,
  hash,
  If,
  instancedArray,
  instanceIndex,
  Loop,
  pass,
  positionLocal,
  sin,
  uniform,
  vec3,
} from "three/tsl";
import { Fn } from "three/tsl";
import Lenis from "lenis";
import "lenis/dist/lenis.css";

/**
 * Base
 */
const isLanding = document.body.dataset.page === "landing";

let lenis = null;
if (isLanding) {
  lenis = new Lenis({
    anchors: true,
    autoRaf: false,
  });
}

// Canvas
const canvas = document.querySelector("canvas.threejs");

// Scene
const scene = new THREE.Scene();

/**
 * Sizes
 */
const sizes = {
  width: window.innerWidth,
  height: window.innerHeight,
};

window.addEventListener("resize", () => {
  // Update sizes
  sizes.width = window.innerWidth;
  sizes.height = window.innerHeight;

  // Update camera
  camera.aspect = sizes.width / sizes.height;
  camera.updateProjectionMatrix();

  // Update renderer
  renderer.setSize(sizes.width, sizes.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

/**
 * Camera
 */
// Base camera
const camera = new THREE.PerspectiveCamera(
  35,
  sizes.width / sizes.height,
  0.1,
  100,
);
camera.position.z = 26;
scene.add(camera);

// Controls (lab only)
let controls = null;
if (!isLanding) {
  controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
}

/**
 * Renderer
 */
const renderer = new THREE.WebGPURenderer({
  canvas: canvas,
  antialias: true,
});
renderer.toneMapping = THREE.CineonToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setSize(sizes.width, sizes.height);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x252028);
if (!isLanding) {
  renderer.inspector = new Inspector();
}
await renderer.init();

/**
 * Post processing
 */
const renderPipeline = new THREE.RenderPipeline(renderer);
const scenePass = pass(scene, camera);
const scenePassColor = scenePass.getTextureNode("output");
const bloomPass = bloom(scenePassColor);
bloomPass.threshold.value = 0;
bloomPass.strength.value = 0.25;

renderPipeline.outputNode = scenePassColor.add(bloomPass);

if (!isLanding) {
  const bloomGui = renderer.inspector.createParameters("Bloom").close();
  bloomGui.add(bloomPass.threshold, "value", 0, 2, 0.01).name("threshold");
  bloomGui.add(bloomPass.strength, "value", 0, 2, 0.01).name("strength");
}

/**
 * Lights
 */
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.3);
directionalLight.castShadow = true;
directionalLight.position.set(1, 1, 0.75).normalize().multiplyScalar(8);
directionalLight.shadow.camera.far = 16;
directionalLight.shadow.camera.top = 8;
directionalLight.shadow.camera.right = 8;
directionalLight.shadow.camera.bottom = -8;
directionalLight.shadow.camera.left = -8;
directionalLight.shadow.mapSize.set(2048, 2048);
directionalLight.shadow.radius = 30;
directionalLight.shadow.normalBias = -0.1;
scene.add(directionalLight);

const cameraHelper = new THREE.CameraHelper(directionalLight.shadow.camera);
// scene.add(cameraHelper)

const ambientLight = new THREE.AmbientLight(0xe8b8ff, 0.08);
scene.add(ambientLight);

if (!isLanding) {
  const lightsGui = renderer.inspector.createParameters("Lights").close();

  lightsGui.addColor(directionalLight, "color").name("directionalColor");
  lightsGui
    .add(directionalLight, "intensity", 0, 5, 0.01)
    .name("directionalIntensity");

  lightsGui.addColor(ambientLight, "color").name("ambientColor");
  lightsGui.add(ambientLight, "intensity", 0, 5, 0.01).name("ambientIntensity");
}

/**
 * Cursor
 */
const raycaster = new THREE.Raycaster();
const cursor = new THREE.Vector2();

const returnHome = uniform(0);
const formCircle = uniform(0);
const homeStrength = uniform(0.06);
const homeSettle = uniform(0.12);
const homeDamping = uniform(3.5);

// Particle color palettes — change these hex values to restyle sections
const PARTICLE_PALETTE = {
  default: {
    base: 0xffffff,
    emissive: 0x335cff,
  },
  stack: {
    base: 0x000000,
    emissive: 0xff5a1f,
  },
};

const particleBaseColor = uniform(color(PARTICLE_PALETTE.default.base));
const emissiveColor = uniform(color(PARTICLE_PALETTE.default.emissive));
const particlePaletteTarget = {
  base: new THREE.Color(PARTICLE_PALETTE.default.base),
  emissive: new THREE.Color(PARTICLE_PALETTE.default.emissive),
};
// Higher = faster blend. ~4 ≈ ~0.5s to settle.
const PARTICLE_PALETTE_BLEND = 4;

const applyParticlePalette = (palette) => {
  particlePaletteTarget.base.setHex(palette.base);
  particlePaletteTarget.emissive.setHex(palette.emissive);
};

/** @type {"hero" | "features" | "stack"} */
let sectionMode = "hero";

document.addEventListener("pointermove", (event) => {
  if (isLanding && sectionMode === "features") return;
  cursor.x = (event.clientX / sizes.width) * 2 - 1;
  cursor.y = -(event.clientY / sizes.height) * 2 + 1;
});

if (isLanding) {
  const sectionIds = ["hero", "features", "stack"];
  const ratios = Object.fromEntries(sectionIds.map((id) => [id, 0]));
  let activeSection = "hero";

  const applySectionMode = () => {
    sectionMode = activeSection;
    returnHome.value = activeSection === "features" ? 1 : 0;
    formCircle.value = activeSection === "stack" ? 1 : 0;
    applyParticlePalette(
      activeSection === "stack"
        ? PARTICLE_PALETTE.stack
        : PARTICLE_PALETTE.default,
    );
  };

  const sectionObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        ratios[entry.target.id] = entry.intersectionRatio;
      }

      const ranked = sectionIds
        .map((id) => ({ id, ratio: ratios[id] ?? 0 }))
        .sort((a, b) => b.ratio - a.ratio);
      const leader = ranked[0];

      if (leader.id !== activeSection) {
        if (leader.ratio >= 0.51) {
          activeSection = leader.id;
          applySectionMode();
        }
      } else if (leader.ratio < 0.35) {
        const next = ranked.find((item) => item.ratio >= 0.51);
        if (next) {
          activeSection = next.id;
          applySectionMode();
        }
      }
    },
    { threshold: [0, 0.35, 0.51, 1] },
  );

  for (const id of sectionIds) {
    const el = document.querySelector(`#${id}`);
    if (el) sectionObserver.observe(el);
  }

  applySectionMode();
}

// cursor helper
const cursorHelper = new THREE.Mesh(
  new THREE.IcosahedronGeometry(1, 3),
  new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true }),
);
// scene.add(cursorHelper);

/**
 * Spheres particles
 */
const count = 4000;
// buffers positoins and velocites
const positionsBuffer = instancedArray(count, "vec3");
const velocitiesBuffer = instancedArray(count, "vec3");
const heatBuffer = instancedArray(count, "float");
const initialPositionsBuffer = instancedArray(count, "vec3");
const circlePositionsBuffer = instancedArray(count, "vec3");

// uniforms
const radius = uniform(0.25);
const gravityStrength = uniform(0.025);
const impactDamping = uniform(0.05);
const generalDamping = uniform(0.4);
const heatDamping = uniform(3);
const heatImpactStrength = uniform(3);
const cursorPosition = uniform(vec3());
const cursorVelocity = uniform(vec3());
const cursorRadius = uniform(2.75);
const cursorStrength = uniform(0.05);
const attractorBL = uniform(vec3(-4, -4, 0));
const attractorTR = uniform(vec3(4, 4, 0));
const attractorStrength = uniform(0.35);
const attractorSoftening = uniform(1.5);

// geometry
const geometry = new THREE.IcosahedronGeometry(1, 2);

// material
const material = new THREE.MeshLambertNodeMaterial();
material.colorNode = particleBaseColor;

// Position
material.positionNode = Fn(() => {
  const position = positionsBuffer.element(instanceIndex);
  //Scale
  positionLocal.mulAssign(radius);
  // translate
  positionLocal.addAssign(position);

  return positionLocal;
})();
// Computes
const initCompute = Fn(() => {
  const position = positionsBuffer.element(instanceIndex);
  const initialPosition = initialPositionsBuffer.element(instanceIndex);
  const circlePosition = circlePositionsBuffer.element(instanceIndex);

  // XZ rectangle at the top of the scene (start / home plane)
  const start = vec3(
    hash(instanceIndex).sub(0.5).mul(20),
    5,
    hash(instanceIndex.add(23).mul(3)).sub(0.5).mul(10),
  );
  position.assign(start);
  initialPosition.assign(start);

  // Golden-angle ring, tilted 45° around X
  const angle = instanceIndex.toFloat().mul(2.399963);
  const circleRadius = float(6);
  const x = sin(angle).mul(circleRadius);
  const z = cos(angle).mul(circleRadius);
  const tilt = float(Math.PI / 2); // 45°
  circlePosition.assign(vec3(x, z.negate().mul(sin(tilt)), z.mul(cos(tilt))));
})().compute(count);

renderer.compute(initCompute);

const updateCompute = Fn(() => {
  const clampedDeltaTime = deltaTime.min(1 / 30);
  // Buffers
  const aPosition = positionsBuffer.element(instanceIndex);
  const aVelocity = velocitiesBuffer.element(instanceIndex);
  const aHeat = heatBuffer.element(instanceIndex);

  // Cursor
  const cursorDistance = aPosition.distance(cursorPosition);
  const cursorDistanceRatio = cursorDistance
    .div(cursorRadius)
    .oneMinus()
    .max(0);
  const _cursorVelocity = cursorVelocity
    .mul(cursorDistanceRatio)
    .mul(cursorStrength);

  aVelocity.addAssign(_cursorVelocity);
  aHeat.addAssign(_cursorVelocity.length().mul(50));

  const liveWeight = returnHome.oneMinus().mul(formCircle.oneMinus());

  //Center gravity
  const toCenter = aPosition.negate().normalize();
  const gravityVelocity = toCenter
    .mul(gravityStrength)
    .mul(clampedDeltaTime)
    .mul(liveWeight);
  aVelocity.addAssign(gravityVelocity);

  // Local attractors (softened inverse-square)
  for (const attractor of [attractorBL, attractorTR]) {
    const delta = attractor.sub(aPosition);
    const distance2 = delta.dot(delta).add(attractorSoftening);
    const pull = delta
      .mul(attractorStrength)
      .div(distance2)
      .mul(clampedDeltaTime)
      .mul(liveWeight);
    aVelocity.addAssign(pull);
  }

  // Pull to the opposite bottom plane (mirrored start: y -> -y) when features is in view
  // Constant gravity-like pull + soft settle (not full spring * distance)
  const homePosition = initialPositionsBuffer
    .element(instanceIndex)
    .mul(vec3(1, -1, 1));
  const toHome = homePosition.sub(aPosition);
  const homeDistance = toHome.length().max(EPSILON);
  const homeDir = toHome.div(homeDistance);
  aVelocity.addAssign(
    homeDir.mul(homeStrength).mul(clampedDeltaTime).mul(returnHome),
  );
  aVelocity.addAssign(
    toHome.mul(homeSettle).mul(clampedDeltaTime).mul(returnHome),
  );

  // Pull into a ring when stack section is in view
  const circlePosition = circlePositionsBuffer.element(instanceIndex);
  const toCircle = circlePosition.sub(aPosition);
  const circleDistance = toCircle.length().max(EPSILON);
  const circleDir = toCircle.div(circleDistance);
  aVelocity.addAssign(
    circleDir.mul(homeStrength).mul(clampedDeltaTime).mul(formCircle),
  );
  aVelocity.addAssign(
    toCircle.mul(homeSettle).mul(clampedDeltaTime).mul(formCircle),
  );

  // Sphere collisions
  Loop(
    { start: instanceIndex.add(1), end: count, condition: "<", name: "i" },
    ({ i }) => {
      // Buffers
      const bPosition = positionsBuffer.element(i);
      const bVelocity = velocitiesBuffer.element(i);
      const bHeat = heatBuffer.element(i);

      // relation to sphere A
      const delta = bPosition.sub(aPosition);
      const distance = delta.length();
      const direction = delta.div(distance.max(EPSILON));

      // since all spheres have the same radius, we can use radius * 2 to check for collisions
      const radius2 = radius.mul(2);
      If(distance.lessThan(radius2), () => {
        // Move away by overlap distance
        const overlap = radius2.sub(distance);
        const avoidance = direction.mul(overlap.div(2));
        aPosition.subAssign(avoidance);
        bPosition.addAssign(avoidance);

        // Apply impact velocities
        const relativeVelocity = aVelocity.sub(bVelocity);
        const impactStrength = dot(relativeVelocity, direction);
        const impactVelocity = direction
          .mul(impactStrength)
          .mul(impactDamping.oneMinus());
        aVelocity.subAssign(impactVelocity);
        bVelocity.addAssign(impactVelocity);

        //impact heat
        const heat = impactStrength.sub(0.01).max(0).mul(heatImpactStrength);
        aHeat.addAssign(heat);
        bHeat.addAssign(heat);
      });
    },
  );

  // apply velocity
  aPosition.addAssign(aVelocity);

  // Velocity damping (stronger while returning home so energy does not stack)
  const activeDamping = generalDamping.add(homeDamping.mul(returnHome));
  aVelocity.mulAssign(activeDamping.mul(clampedDeltaTime).oneMinus());

  // Heat damping
  aHeat.mulAssign(heatDamping.mul(clampedDeltaTime).oneMinus());
})().compute(count);

// Emisseve
const heat = heatBuffer.element(instanceIndex);
material.emissiveNode = emissiveColor.mul(heat);

const mesh = new THREE.Mesh(geometry, material);
mesh.castShadow = true;
mesh.receiveShadow = true;
mesh.frustumCulled = false;
mesh.count = count;
scene.add(mesh);

if (!isLanding) {
  const sphereGui = renderer.inspector.createParameters("Spheres").close();
  sphereGui.add(radius, "value", 0.1, 0.5, 0.001).name("radius");
  sphereGui
    .add(gravityStrength, "value", 0, 0.1, 0.001)
    .name("gravityStrength");
  sphereGui.add(impactDamping, "value", 0, 0.1, 0.001).name("impactDamping");
  sphereGui.add(generalDamping, "value", 0, 1, 0.01).name("generalDamping");
  sphereGui.add(heatDamping, "value", 0, 10, 0.1).name("heatDamping");
  sphereGui
    .add(heatImpactStrength, "value", 0, 100, 0.1)
    .name("heatImpactStrength");
  sphereGui.addColor(emissiveColor, "value").name("emissiveColor");

  sphereGui.add(cursorRadius, "value", 0, 5, 0.001).name("cursorRadius");
  sphereGui.add(cursorStrength, "value", 0, 0.2, 0.001).name("cursorStrength");
  sphereGui
    .add(attractorStrength, "value", 0, 2, 0.01)
    .name("attractorStrength");
  sphereGui
    .add(attractorSoftening, "value", 0.1, 10, 0.1)
    .name("attractorSoftening");
  sphereGui.add(attractorBL.value, "x", -8, 8, 0.1).name("attractorBL.x");
  sphereGui.add(attractorBL.value, "y", -8, 8, 0.1).name("attractorBL.y");
  sphereGui.add(attractorTR.value, "x", -8, 8, 0.1).name("attractorTR.x");
  sphereGui.add(attractorTR.value, "y", -8, 8, 0.1).name("attractorTR.y");
}

/**
 * Animate
 */
const timer = new THREE.Timer();
timer.connect(document);
const cameraOrbitRadius = camera.position.length();
const cameraLookAt = new THREE.Vector3(0, 0, 0);

const tick = (timestamp) => {
  timer.update(timestamp);

  if (lenis) {
    lenis.raf(timestamp);
  }

  const paletteBlend = 1 - Math.exp(-PARTICLE_PALETTE_BLEND * timer.getDelta());
  particleBaseColor.value.lerp(particlePaletteTarget.base, paletteBlend);
  emissiveColor.value.lerp(particlePaletteTarget.emissive, paletteBlend);

  if (controls) {
    controls.update();
  } else if (isLanding && sectionMode !== "stack") {
    const elapsed = timer.getElapsed();
    const angle = elapsed * 0.12;
    const lift = Math.sin(elapsed * 0.35) * 1.4;
    camera.position.set(
      Math.sin(angle) * cameraOrbitRadius,
      lift + 1.5,
      Math.cos(angle) * cameraOrbitRadius,
    );
    camera.lookAt(cameraLookAt);
  } else if (isLanding && sectionMode === "stack") {
    camera.position.set(0, 1.5, cameraOrbitRadius);
    camera.lookAt(cameraLookAt);
  }

  // Cursor + raycaster (hero + stack; muted on features)
  if (!isLanding || sectionMode !== "features") {
    raycaster.setFromCamera(cursor, camera);
    const planeNormal = camera.position.clone().normalize();
    const plane = new THREE.Plane(planeNormal, 0);

    const intersect = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, intersect);

    cursorHelper.position.copy(intersect);

    // Cursor velocity
    cursorVelocity.value.copy(intersect).sub(cursorPosition.value);
    cursorPosition.value.copy(intersect);
  } else {
    cursorVelocity.value.set(0, 0, 0);
  }

  // Computes
  renderer.compute(updateCompute);

  // Render
  renderPipeline.render();
};

renderer.setAnimationLoop(tick);
