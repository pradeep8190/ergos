/**
 * NOTHRIC - Liquid Interactive Canvas
 * Based on Navier-Stokes Fluid Dynamics & WebGL GLSL Shaders extracted from weareuprising.com
 */

(function () {
  'use strict';

  // --- GLSL SHADERS ---

  const baseVertexShader = `
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform vec2 texelSize;

    void main() {
      vUv = uv;
      vL = vUv - vec2(texelSize.x, 0.0);
      vR = vUv + vec2(texelSize.x, 0.0);
      vT = vUv + vec2(0.0, texelSize.y);
      vB = vUv - vec2(0.0, texelSize.y);
      gl_Position = vec4(position, 1.0);
    }
  `;

  const splatShader = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uTarget;
    uniform float aspectRatio;
    uniform vec3 color;
    uniform vec2 point;
    uniform float radius;

    void main() {
      vec2 p = vUv - point;
      p.x *= aspectRatio;
      vec3 splat = exp(-dot(p, p) / radius) * color;
      vec3 base = texture2D(uTarget, vUv).xyz;
      gl_FragColor = vec4(base + splat, 1.0);
    }
  `;

  const advectionShader = `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uVelocity;
    uniform sampler2D uSource;
    uniform vec2 texelSize;
    uniform float dt;
    uniform float dissipation;

    void main() {
      vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
      gl_FragColor = dissipation * texture2D(uSource, coord);
    }
  `;

  const divergenceShader = `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uVelocity;

    void main() {
      float L = texture2D(uVelocity, vL).x;
      float R = texture2D(uVelocity, vR).x;
      float T = texture2D(uVelocity, vT).y;
      float B = texture2D(uVelocity, vB).y;

      vec2 C = texture2D(uVelocity, vUv).xy;
      if (vL.x < 0.0) L = -C.x;
      if (vR.x > 1.0) R = -C.x;
      if (vT.y > 1.0) T = -C.y;
      if (vB.y < 0.0) B = -C.y;

      float div = 0.5 * (R - L + T - B);
      gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
    }
  `;

  const curlShader = `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uVelocity;

    void main() {
      float L = texture2D(uVelocity, vL).y;
      float R = texture2D(uVelocity, vR).y;
      float T = texture2D(uVelocity, vT).x;
      float B = texture2D(uVelocity, vB).x;
      float vorticity = R - L - T + B;
      gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
    }
  `;

  const vorticityShader = `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uVelocity;
    uniform sampler2D uCurl;
    uniform float curl;
    uniform float dt;

    void main() {
      float L = texture2D(uCurl, vL).x;
      float R = texture2D(uCurl, vR).x;
      float T = texture2D(uCurl, vT).x;
      float B = texture2D(uCurl, vB).x;
      float C = texture2D(uCurl, vUv).x;

      vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
      force /= length(force) + 0.0001;
      force *= curl * C;
      force.y *= -1.0;

      vec2 vel = texture2D(uVelocity, vUv).xy;
      gl_FragColor = vec4(vel + force * dt, 0.0, 1.0);
    }
  `;

  const pressureShader = `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uPressure;
    uniform sampler2D uDivergence;

    void main() {
      float L = texture2D(uPressure, vL).x;
      float R = texture2D(uPressure, vR).x;
      float T = texture2D(uPressure, vT).x;
      float B = texture2D(uPressure, vB).x;
      float divergence = texture2D(uDivergence, vUv).x;
      float pressure = (L + R + B + T - divergence) * 0.25;
      gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
    }
  `;

  const gradientSubtractShader = `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uPressure;
    uniform sampler2D uVelocity;

    void main() {
      float L = texture2D(uPressure, vL).x;
      float R = texture2D(uPressure, vR).x;
      float T = texture2D(uPressure, vT).x;
      float B = texture2D(uPressure, vB).x;
      vec2 velocity = texture2D(uVelocity, vUv).xy;
      velocity -= vec2(R - L, T - B) * 0.5;
      gl_FragColor = vec4(velocity, 0.0, 1.0);
    }
  `;

  // Extracted Composition / Display Shader from weareuprising.com
  const displayFragmentShader = `
    precision highp float;
    precision highp sampler2D;

    uniform sampler2D tDiffuse;
    uniform sampler2D uFluid;
    uniform vec2 uResolution;
    uniform vec2 uImage;
    uniform float uScrollDelta;
    uniform float uAlign;

    varying vec2 vUv;

    vec4 RGBShift(sampler2D tDiffuse, vec2 uv, float angle, float amount) {
      vec2 offset = amount * vec2(cos(angle), sin(angle));
      vec4 cr = texture2D(tDiffuse, uv + offset * 2.0);
      vec4 cga = texture2D(tDiffuse, uv);
      vec4 cb = texture2D(tDiffuse, uv + offset);
      return vec4(cr.r, cga.g, cb.b, cga.a);
    }

    vec2 contain(vec2 st, vec2 resolution, vec2 image, float align) {
      vec2 s = resolution;
      vec2 i = image;
      float rs = s.x / s.y;
      float ri = i.x / i.y;
      vec2 newSize = rs > ri ? vec2(i.x * s.y / i.y, s.y) : vec2(s.x, i.y * s.x / i.x);
      vec2 offset = (rs > ri ? vec2((s.x - newSize.x) / 2.0, 0.0) : vec2(0.0, ((s.y - newSize.y) * align) / 1.0)) / s;
      return (st * s - offset * s) / newSize;
    }

    vec3 adjustSaturation(vec3 color, float value) {
      const vec3 luminosityFactor = vec3(0.2126, 0.7152, 0.0722);
      vec3 grayscale = vec3(dot(color, luminosityFactor));
      return mix(grayscale, color, 1.0 + value);
    }

    void main() {
      vec2 uv = vUv;

      vec4 fluid = texture2D(uFluid, uv);
      vec2 distortion = fluid.xy * 0.06;
      vec2 distortedUv = uv - distortion;

      vec2 containUV = contain(distortedUv, uResolution, uImage, 0.5);

      float shiftAmount = length(fluid.xy) * 0.03 + abs(uScrollDelta) * 0.001;
      vec3 color = RGBShift(tDiffuse, containUV, 0.0, shiftAmount).rgb;

      color = adjustSaturation(color, 0.3);

      if (containUV.x < 0.0 || containUV.x > 1.0 || containUV.y < 0.0 || containUV.y > 1.0) {
        color = vec3(0.04, 0.04, 0.06);
      }

      gl_FragColor = vec4(color, 1.0);
    }
  `;

  // --- FLUID SIMULATION CLASS ---

  class FluidSimulation {
    constructor(renderer, width, height) {
      this.renderer = renderer;
      this.width = width;
      this.height = height;

      this.simRes = 128; // Fluid simulation resolution
      this.texelSize = new THREE.Vector2(1.0 / this.simRes, 1.0 / this.simRes);

      // Simulation parameters
      this.config = {
        CURL: 30.0,
        PRESSURE_ITERATIONS: 20,
        VELOCITY_DISSIPATION: 0.98,
        DENSITY_DISSIPATION: 0.97,
        SPLAT_RADIUS: 0.004,
      };

      this.initFBOs();
      this.initMaterials();
      this.initQuad();
    }

    createFBO() {
      return new THREE.WebGLRenderTarget(this.simRes, this.simRes, {
        type: THREE.HalfFloatType || THREE.FloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
        stencilBuffer: false,
      });
    }

    createDoubleFBO() {
      let fbo1 = this.createFBO();
      let fbo2 = this.createFBO();
      return {
        read: fbo1,
        write: fbo2,
        swap: function () {
          let temp = this.read;
          this.read = this.write;
          this.write = temp;
        },
      };
    }

    initFBOs() {
      this.velocity = this.createDoubleFBO();
      this.density = this.createDoubleFBO();
      this.divergence = this.createFBO();
      this.curl = this.createFBO();
      this.pressure = this.createDoubleFBO();
    }

    initMaterials() {
      this.splatMat = new THREE.ShaderMaterial({
        vertexShader: baseVertexShader,
        fragmentShader: splatShader,
        uniforms: {
          uTarget: { value: null },
          aspectRatio: { value: this.width / this.height },
          color: { value: new THREE.Vector3() },
          point: { value: new THREE.Vector2() },
          radius: { value: this.config.SPLAT_RADIUS },
          texelSize: { value: this.texelSize },
        },
      });

      this.advectionMat = new THREE.ShaderMaterial({
        vertexShader: baseVertexShader,
        fragmentShader: advectionShader,
        uniforms: {
          uVelocity: { value: null },
          uSource: { value: null },
          dt: { value: 0.016 },
          dissipation: { value: this.config.VELOCITY_DISSIPATION },
          texelSize: { value: this.texelSize },
        },
      });

      this.divergenceMat = new THREE.ShaderMaterial({
        vertexShader: baseVertexShader,
        fragmentShader: divergenceShader,
        uniforms: {
          uVelocity: { value: null },
          texelSize: { value: this.texelSize },
        },
      });

      this.curlMat = new THREE.ShaderMaterial({
        vertexShader: baseVertexShader,
        fragmentShader: curlShader,
        uniforms: {
          uVelocity: { value: null },
          texelSize: { value: this.texelSize },
        },
      });

      this.vorticityMat = new THREE.ShaderMaterial({
        vertexShader: baseVertexShader,
        fragmentShader: vorticityShader,
        uniforms: {
          uVelocity: { value: null },
          uCurl: { value: null },
          curl: { value: this.config.CURL },
          dt: { value: 0.016 },
          texelSize: { value: this.texelSize },
        },
      });

      this.pressureMat = new THREE.ShaderMaterial({
        vertexShader: baseVertexShader,
        fragmentShader: pressureShader,
        uniforms: {
          uPressure: { value: null },
          uDivergence: { value: null },
          texelSize: { value: this.texelSize },
        },
      });

      this.gradientSubMat = new THREE.ShaderMaterial({
        vertexShader: baseVertexShader,
        fragmentShader: gradientSubtractShader,
        uniforms: {
          uPressure: { value: null },
          uVelocity: { value: null },
          texelSize: { value: this.texelSize },
        },
      });
    }

    initQuad() {
      this.scene = new THREE.Scene();
      this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
      this.scene.add(this.mesh);
    }

    renderQuad(material, target) {
      this.mesh.material = material;
      this.renderer.setRenderTarget(target);
      this.renderer.render(this.scene, this.camera);
      this.renderer.setRenderTarget(null);
    }

    splat(x, y, dx, dy, color) {
      // Velocity splat
      this.splatMat.uniforms.uTarget.value = this.velocity.read.texture;
      this.splatMat.uniforms.point.value.set(x, y);
      this.splatMat.uniforms.color.value.set(dx, dy, 0.0);
      this.renderQuad(this.splatMat, this.velocity.write);
      this.velocity.swap();
    }

    step(dt) {
      // 1. Curl
      this.curlMat.uniforms.uVelocity.value = this.velocity.read.texture;
      this.renderQuad(this.curlMat, this.curl);

      // 2. Vorticity Confinement
      this.vorticityMat.uniforms.uVelocity.value = this.velocity.read.texture;
      this.vorticityMat.uniforms.uCurl.value = this.curl.texture;
      this.vorticityMat.uniforms.dt.value = dt;
      this.renderQuad(this.vorticityMat, this.velocity.write);
      this.velocity.swap();

      // 3. Divergence
      this.divergenceMat.uniforms.uVelocity.value = this.velocity.read.texture;
      this.renderQuad(this.divergenceMat, this.divergence);

      // 4. Pressure Jacobi solver
      this.pressureMat.uniforms.uDivergence.value = this.divergence.texture;
      for (let i = 0; i < this.config.PRESSURE_ITERATIONS; i++) {
        this.pressureMat.uniforms.uPressure.value = this.pressure.read.texture;
        this.renderQuad(this.pressureMat, this.pressure.write);
        this.pressure.swap();
      }

      // 5. Gradient Subtraction
      this.gradientSubMat.uniforms.uPressure.value = this.pressure.read.texture;
      this.gradientSubMat.uniforms.uVelocity.value = this.velocity.read.texture;
      this.renderQuad(this.gradientSubMat, this.velocity.write);
      this.velocity.swap();

      // 6. Advection
      this.advectionMat.uniforms.uVelocity.value = this.velocity.read.texture;
      this.advectionMat.uniforms.uSource.value = this.velocity.read.texture;
      this.advectionMat.uniforms.dt.value = dt;
      this.advectionMat.uniforms.dissipation.value = this.config.VELOCITY_DISSIPATION;
      this.renderQuad(this.advectionMat, this.velocity.write);
      this.velocity.swap();
    }

    getVelocityTexture() {
      return this.velocity.read.texture;
    }

    resize(width, height) {
      this.width = width;
      this.height = height;
      this.splatMat.uniforms.aspectRatio.value = width / height;
    }
  }

  // --- APP INITIALIZATION ---

  const container = document.getElementById('webgl-container');
  let width = window.innerWidth;
  let height = window.innerHeight;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const fluidSim = new FluidSimulation(renderer, width, height);

  // Generate dynamic procedural canvas texture as background image
  function createHeroTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const ctx = canvas.getContext('2d');

    // Deep dark gradient background
    const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    grad.addColorStop(0, '#0a0d1a');
    grad.addColorStop(0.5, '#121829');
    grad.addColorStop(1, '#05070d');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Glowing geometric liquid elements
    ctx.save();
    ctx.shadowBlur = 40;
    ctx.shadowColor = 'rgba(58, 134, 255, 0.6)';

    ctx.fillStyle = '#3a86ff';
    ctx.beginPath();
    ctx.arc(1300, 350, 220, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowColor = 'rgba(0, 240, 255, 0.5)';
    ctx.fillStyle = '#00f0ff';
    ctx.beginPath();
    ctx.arc(600, 750, 180, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Subtle grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 80) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 80) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.imageSize = new THREE.Vector2(canvas.width, canvas.height);
    return texture;
  }

  const heroTexture = createHeroTexture();

  // Final Composition Scene setup
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const displayMat = new THREE.ShaderMaterial({
    vertexShader: baseVertexShader,
    fragmentShader: displayFragmentShader,
    uniforms: {
      tDiffuse: { value: heroTexture },
      uFluid: { value: fluidSim.getVelocityTexture() },
      uResolution: { value: new THREE.Vector2(width, height) },
      uImage: { value: heroTexture.imageSize },
      uScrollDelta: { value: 0 },
      uAlign: { value: 0.5 },
      texelSize: { value: new THREE.Vector2(1 / width, 1 / height) },
    },
  });

  const displayMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), displayMat);
  scene.add(displayMesh);

  // Mouse / Touch Interaction Tracking
  let pointer = {
    x: 0,
    y: 0,
    prevX: 0,
    prevY: 0,
    isDown: false,
    moved: false,
  };

  function updatePointer(e) {
    const x = e.clientX / window.innerWidth;
    const y = 1.0 - e.clientY / window.innerHeight; // Flip Y for WebGL

    pointer.prevX = pointer.x;
    pointer.prevY = pointer.y;
    pointer.x = x;
    pointer.y = y;

    const dx = (pointer.x - pointer.prevX) * 5.0;
    const dy = (pointer.y - pointer.prevY) * 5.0;

    fluidSim.splat(pointer.x, pointer.y, dx, dy);
  }

  window.addEventListener('mousemove', (e) => {
    updatePointer(e);
  });

  window.addEventListener('touchmove', (e) => {
    if (e.touches.length > 0) {
      updatePointer(e.touches[0]);
    }
  });

  // Initial ambient fluid movement splats
  let initialTime = 0;

  // Resize handler
  window.addEventListener('resize', () => {
    width = window.innerWidth;
    height = window.innerHeight;

    renderer.setSize(width, height);
    fluidSim.resize(width, height);

    displayMat.uniforms.uResolution.value.set(width, height);
    displayMat.uniforms.texelSize.value.set(1 / width, 1 / height);
  });

  // Animation Loop
  let lastTime = performance.now();

  function animate() {
    requestAnimationFrame(animate);

    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.033);
    lastTime = now;

    // Ambient floating motion when idle
    initialTime += dt;
    if (initialTime < 5.0) {
      const rx = 0.5 + Math.sin(initialTime * 2.0) * 0.2;
      const ry = 0.5 + Math.cos(initialTime * 1.5) * 0.2;
      fluidSim.splat(rx, ry, Math.sin(initialTime * 3.0) * 0.2, Math.cos(initialTime * 3.0) * 0.2);
    }

    // Step GPGPU fluid simulation
    fluidSim.step(dt);

    // Update display uniforms & render final scene
    displayMat.uniforms.uFluid.value = fluidSim.getVelocityTexture();
    renderer.render(scene, camera);
  }

  animate();
})();
