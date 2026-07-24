/**
 * Graphics Engine — Modern Rendering Pipeline
 * High-Fidelity Anti-Aliasing, HDRI Lighting, Golden Hour Atmosphere, Post-Processing Stack
 * 
 * INTEGRATION:
 * 1. Import this module in index.html: import { GraphicsEngine } from './graphics-engine.js';
 * 2. Initialize after Three.js setup: const graphicsEngine = new GraphicsEngine(scene, camera, renderer);
 * 3. Replace composer.render() with graphicsEngine.render() in animation loop
 * 4. Call graphicsEngine.onWindowResize() in window resize handler
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

// ============================================================================
// SHADER: Screen Space Ambient Occlusion (Simplified & Stable)
// ============================================================================
const SSAOShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    size: { value: new THREE.Vector2(1920, 1080) },
    cameraNear: { value: 0.1 },
    cameraFar: { value: 2000 },
    radius: { value: 8.0 },
    intensity: { value: 0.6 },
    minDistance: { value: 0.005 },
    maxDistance: { value: 0.1 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    #include <common>
    #include <packing>
    
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec2 size;
    uniform float cameraNear;
    uniform float cameraFar;
    uniform float radius;
    uniform float intensity;
    uniform float minDistance;
    uniform float maxDistance;
    
    varying vec2 vUv;
    
    float readDepth(sampler2D depthSampler, vec2 coord) {
      float fragCoordZ = texture2D(depthSampler, coord).x;
      if(fragCoordZ == 0.0) return 1.0;  // Far plane default
      
      float viewZ = perspectiveDepthToViewZ(fragCoordZ, cameraNear, cameraFar);
      return viewZToOrthographicDepth(viewZ, cameraNear, cameraFar);
    }
    
    float ssaoRand(vec2 co) {
      return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
    }
    
    void main() {
      vec4 sceneColor = texture2D(tDiffuse, vUv);
      float centerDepth = readDepth(tDepth, vUv);
      
      // Safely handle edge cases
      centerDepth = clamp(centerDepth, 0.0, 1.0);
      
      // Skip SSAO for far away objects (sky)
      if(centerDepth > 0.98) {
        gl_FragColor = sceneColor;
        return;
      }
      
      // Skip if depth reading failed
      if(abs(centerDepth - 1.0) < 0.01) {
        gl_FragColor = sceneColor;
        return;
      }
      
      float occlusion = 0.0;
      float sampleCount = 0.0;
      vec2 texelSize = 1.0 / size;
      
      // Sample in a circle around the current pixel
      for(int i = 0; i < 12; i++) {
        float angle = float(i) * 6.283185 / 12.0;  // 2π/12
        vec2 dir = vec2(cos(angle), sin(angle));
        
        // Multiple distances for better coverage
        for(int d = 1; d <= 2; d++) {
          float dist = float(d) * radius * texelSize.x;
          vec2 sampleCoord = vUv + dir * dist;
          
          // Bounds check
          if(sampleCoord.x >= 0.0 && sampleCoord.x <= 1.0 && 
             sampleCoord.y >= 0.0 && sampleCoord.y <= 1.0) {
            
            float sampleDepth = readDepth(tDepth, sampleCoord);
            sampleDepth = clamp(sampleDepth, 0.0, 1.0);
            
            float depthDiff = centerDepth - sampleDepth;
            
            // Calculate occlusion: sample is occluding if it's closer (in depth space)
            if(depthDiff > minDistance && depthDiff < maxDistance) {
              float occ = smoothstep(0.0, maxDistance, depthDiff);
              occlusion += occ * 0.5;
            }
            
            sampleCount += 1.0;
          }
        }
      }
      
      // Final AO calculation
      float ao = 1.0;
      if(sampleCount > 0.0) {
        ao = 1.0 - (occlusion / sampleCount) * intensity;
      }
      
      ao = clamp(ao, 0.1, 1.0);  // Ensure minimum brightness
      gl_FragColor = vec4(sceneColor.rgb * ao, sceneColor.a);
    }
  `
};

// ============================================================================
// SHADER: Color Correction & Film Grading (no extra gamma — renderer sRGB handles it)
// ============================================================================
const ColorCorrectionShader = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1.15 },
    brightness: { value: 1.05 },
    contrast: { value: 1.1 },
    warmth: { value: 0.12 },
    vignette: { value: 0.25 },
    liftShadows: { value: new THREE.Vector3(0.03, 0.03, 0.06) }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float brightness;
    uniform float contrast;
    uniform float warmth;
    uniform float vignette;
    uniform vec3 liftShadows;
    
    varying vec2 vUv;
    
    void main() {
      vec3 color = texture2D(tDiffuse, vUv).rgb;
      
      // Lift shadows (subtle cool tone in darks)
      color = mix(color, color + liftShadows, 0.25);
      
      // Brightness
      color *= brightness;
      
      // Contrast (pivot at 0.5 gray)
      color = mix(vec3(0.5), color, contrast);
      
      // Saturation
      float gray = dot(color, vec3(0.299, 0.587, 0.114));
      color = mix(vec3(gray), color, saturation);
      
      // Warmth (golden hour tint)
      color.r += warmth * 0.08;
      color.g += warmth * 0.04;
      color.b -= warmth * 0.02;
      
      // Vignette
      vec2 vignCoord = vUv - vec2(0.5);
      float vig = 1.0 - dot(vignCoord, vignCoord) * vignette;
      color *= clamp(vig, 0.0, 1.0);
      
      gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }
  `
};

// ============================================================================
// SHADER: FXAA (Fast Approximate Anti-Aliasing) — final edge cleanup
// ============================================================================
const FXAAShader = {
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new THREE.Vector2(1.0 / 1920.0, 1.0 / 1080.0) }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    varying vec2 vUv;
    
    #define FXAA_REDUCE_MIN   (1.0 / 128.0)
    #define FXAA_REDUCE_MUL   (1.0 / 8.0)
    #define FXAA_SPAN_MAX     8.0
    
    void main() {
      vec3 rgbNW = texture2D(tDiffuse, vUv + vec2(-1.0, -1.0) * resolution).rgb;
      vec3 rgbNE = texture2D(tDiffuse, vUv + vec2( 1.0, -1.0) * resolution).rgb;
      vec3 rgbSW = texture2D(tDiffuse, vUv + vec2(-1.0,  1.0) * resolution).rgb;
      vec3 rgbSE = texture2D(tDiffuse, vUv + vec2( 1.0,  1.0) * resolution).rgb;
      vec3 rgbM  = texture2D(tDiffuse, vUv).rgb;
      
      vec3 luma = vec3(0.299, 0.587, 0.114);
      float lumaNW = dot(rgbNW, luma);
      float lumaNE = dot(rgbNE, luma);
      float lumaSW = dot(rgbSW, luma);
      float lumaSE = dot(rgbSE, luma);
      float lumaM  = dot(rgbM, luma);
      
      float lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
      float lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));
      
      vec2 dir;
      dir.x = -((lumaNW + lumaNE) - (lumaSW + lumaSE));
      dir.y =  ((lumaNW + lumaSW) - (lumaNE + lumaSE));
      
      float dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * (0.25 * FXAA_REDUCE_MUL), FXAA_REDUCE_MIN);
      float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
      dir = min(vec2(FXAA_SPAN_MAX), max(vec2(-FXAA_SPAN_MAX), dir * rcpDirMin)) * resolution;
      
      vec3 rgbA = 0.5 * (
        texture2D(tDiffuse, vUv + dir * (1.0 / 3.0 - 0.5)).rgb +
        texture2D(tDiffuse, vUv + dir * (2.0 / 3.0 - 0.5)).rgb
      );
      vec3 rgbB = rgbA * 0.5 + 0.25 * (
        texture2D(tDiffuse, vUv + dir * -0.5).rgb +
        texture2D(tDiffuse, vUv + dir *  0.5).rgb
      );
      
      float lumaB = dot(rgbB, luma);
      
      if(lumaB < lumaMin || lumaB > lumaMax) {
        gl_FragColor = vec4(rgbA, 1.0);
      } else {
        gl_FragColor = vec4(rgbB, 1.0);
      }
    }
  `
};

// ============================================================================
// GRAPHICS ENGINE CLASS
// ============================================================================
export class GraphicsEngine {
  constructor(scene, camera, renderer) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.composer = null;
    this.depthTarget = null;
    this.passes = {};
    this.sunLight = null;  // stored for time-of-day control
    this._composerErrorCount = 0;
    
    this.initialize();
  }

  initialize() {
    console.log('🎨 Initializing Graphics Engine...');
    
    try {
      this.setupRenderer();
      this.setupSkyAndFog();
      this.setupHDRIEnvironment();
      this.setupGoldenHourLighting();
      this.setupPostProcessing();
      console.log('✨ Graphics Engine initialized successfully!');
    } catch (error) {
      console.error('❌ Graphics Engine initialization error:', error);
    }
  }

  setupRenderer() {
    // Force high-fidelity rendering: Cap at 2x to prevent extreme GPU load on 3x+ HiDPI screens
    // This ensures crispy, high-density rendering for clean edges
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;  // Realistic color tone, less saturated orange
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.VSMShadowMap;
    console.log(`✓ Renderer: pixelRatio=${Math.min(window.devicePixelRatio, 2)}, ACES tone mapping (1.0x), VSM shadows`);
  }

  setupSkyAndFog() {
    // World-up based gradient sky (fixes flip when camera rotates)
    // Creates a sphere-mapped gradient that stays correct regardless of camera angle
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    
    // Vertical gradient (sky to ground, based on world Y)
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0.0, '#0d1b2a');   // Deep navy zenith
    gradient.addColorStop(0.15, '#1b2838');   // Dark blue
    gradient.addColorStop(0.35, '#415a77');   // Steel blue
    gradient.addColorStop(0.50, '#c4784a');   // Burnt orange at horizon
    gradient.addColorStop(0.60, '#e8985a');   // Warm amber
    gradient.addColorStop(0.70, '#f4c67a');   // Golden
    gradient.addColorStop(0.85, '#fde8c8');   // Pale warm white
    gradient.addColorStop(1.0, '#d4c5a0');    // Ground reflection
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Create texture and apply as equirectangular (maintains world-up orientation)
    const skyTexture = new THREE.CanvasTexture(canvas);
    skyTexture.mapping = THREE.EquirectangularReflectionMapping;
    this.scene.background = skyTexture;
    
    // Atmospheric fog — warm tone matching golden hour
    this.scene.fog = new THREE.FogExp2(0xc8a882, 0.0006);
    console.log('✓ World-up based golden hour sky gradient (prevents flip) and atmospheric fog');
  }

  setupHDRIEnvironment() {
    const loader = new THREE.TextureLoader();
    // Use the panorama already present in the project for image-based lighting
    loader.load('Data UTM/360 Images/PXL_1.jpg', (texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      texture.colorSpace = THREE.SRGBColorSpace;
      this.scene.environment = texture;
      this.scene.environmentIntensity = 0.6;
      console.log('✓ HDRI environment loaded — image-based lighting active');
    }, undefined, (err) => {
      console.warn('ℹ HDRI load skipped (file not found). IBL from lights only.', err?.message);
    });
  }

  setupGoldenHourLighting() {
    // ---- Primary Sun (warm amber, low angle for long cinematic shadows) ----
    const sun = new THREE.DirectionalLight(0xFFB347, 1.8);
    sun.position.set(-150, 100, 120);
    sun.castShadow = true;
    sun.shadow.camera.left = -400;
    sun.shadow.camera.right = 400;
    sun.shadow.camera.top = 400;
    sun.shadow.camera.bottom = -400;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 500;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.bias = -0.0001;
    sun.shadow.radius = 4;
    sun.shadow.blurSamples = 16;
    this.scene.add(sun);
    this.sunLight = sun;  // store reference for time-of-day
    console.log('✓ Golden hour sun (amber, shadow-casting)');
    
    // ---- Rim Light (orange highlights on edges opposite the sun) ----
    const rim = new THREE.DirectionalLight(0xFFA500, 0.6);
    rim.position.set(150, -120, 80);
    this.scene.add(rim);
    console.log('✓ Rim light (orange edge highlights)');
    
    // ---- Fill Light (sky blue to soften harsh shadows) ----
    const fill = new THREE.DirectionalLight(0x87CEEB, 0.5);
    fill.position.set(80, -150, 60);
    this.scene.add(fill);
    console.log('✓ Fill light (sky blue shadow softener)');
    
    // ---- Ambient Light (reduce golden hour tint, use cool blue-grey) ----
    // Reduced intensity and cool color counteracts orange "golden hour" glow on grass
    const ambient = new THREE.AmbientLight(0x404040, 0.4);
    this.scene.add(ambient);
    console.log('✓ Ambient light (cool blue-grey 0x404040, 0.4 intensity)');
    
    // ---- Hemisphere Light (natural sky/ground color bounce) ----
    // Sky color: light blue, Ground color: neutral grey (reduces orange tint)
    const hemi = new THREE.HemisphereLight(0x87CEEB, 0x808080, 0.25);
    this.scene.add(hemi);
    console.log('✓ Hemisphere light (sky/neutral ground bounce)');
  }

  setupPostProcessing() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = this.renderer.getPixelRatio();
    
    // Create render target with depth texture
    // Use standard types for maximum GPU compatibility
    const renderTarget = new THREE.WebGLRenderTarget(w * pr, h * pr, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      samples: 4 // 4x MSAA — widely supported without issues
    });
    renderTarget.depthTexture = new THREE.DepthTexture();
    renderTarget.depthTexture.type = THREE.UnsignedIntType;
    
    // EffectComposer uses this render target (depth captured during RenderPass — no extra render!)
    this.composer = new EffectComposer(this.renderer, renderTarget);
    
    // Pass 1: Render scene (also fills depthTexture)
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);
    this.passes.render = renderPass;
    console.log('✓ Pass 1: RenderPass (with depth capture)');
    
    // Pass 2: SSAO (reads depth from composer's render target — DISABLED by default for performance)
    const ssaoPass = new ShaderPass(SSAOShader);
    ssaoPass.uniforms.size.value.set(w * pr, h * pr);
    ssaoPass.uniforms.cameraNear.value = this.camera.near;
    ssaoPass.uniforms.cameraFar.value = this.camera.far;
    ssaoPass.uniforms.tDiffuse.value = renderTarget.texture;  // Input color from RenderPass
    ssaoPass.uniforms.tDepth.value = renderTarget.depthTexture;  // Depth texture
    ssaoPass.uniforms.radius.value = 8.0;
    ssaoPass.uniforms.intensity.value = 0.6;
    ssaoPass.uniforms.minDistance.value = 0.005;
    ssaoPass.uniforms.maxDistance.value = 0.1;
    ssaoPass.enabled = false;  // OFF by default — user can enable in Graphics settings
    this.composer.addPass(ssaoPass);
    this.passes.ssao = ssaoPass;
    console.log('✓ Pass 2: SSAO (depth-based ambient occlusion, disabled by default)');
    
    // Pass 3: Bloom (subtle highlight glow)
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      0.3,   // strength — subtle
      0.5,   // radius
      0.85   // threshold
    );
    bloomPass.enabled = false;  // OFF by default — user can enable in Graphics settings
    this.composer.addPass(bloomPass);
    this.passes.bloom = bloomPass;
    console.log('✓ Pass 3: UnrealBloom (strength=0.3, threshold=0.85, disabled by default)');
    
    // Pass 4: Color correction & cinematic grading
    const colorPass = new ShaderPass(ColorCorrectionShader);
    this.composer.addPass(colorPass);
    this.passes.colorCorrection = colorPass;
    console.log('✓ Pass 4: Color Grading');
    
    // Pass 5: FXAA (edge-smoothing)
    const fxaaPass = new ShaderPass(FXAAShader);
    fxaaPass.uniforms.resolution.value.set(1.0 / (w * pr), 1.0 / (h * pr));
    fxaaPass.enabled = false;  // Disabled: MSAA + SMAA is superior; FXAA adds unnecessary blur
    this.composer.addPass(fxaaPass);
    this.passes.fxaa = fxaaPass;
    console.log('✓ Pass 5: FXAA (Disabled to improve sharpness)');
    
    // Pass 6: SMAA (final anti-aliasing — MUST be last for crisp edges)
    // SMAA is more advanced than FXAA and provides superior edge quality
    const smaaPass = new SMAAPass(w * pr, h * pr);
    // Make edges more sensitive to catch jagged building edges
    if (smaaPass.edgesMaterial) {
      smaaPass.edgesMaterial.uniforms.threshold.value = 0.1;  // Standard sensitivity to avoid over-blurring
    }
    smaaPass.enabled = false;  // OFF by default — user can enable in Graphics settings
    this.composer.addPass(smaaPass);
    this.passes.smaa = smaaPass;
    console.log('✓ Pass 6: SMAA (threshold=0.05, disabled by default)');
    
    console.log('✓ Post-processing pipeline complete (6 passes: Render→SSAO→Bloom→ColorCorrection→FXAA→SMAA, SSAO/Bloom/SMAA off by default)');
  }

  render() {
    // Ensure the full scene graph (player → camera) has fresh world matrices
    if (this.scene.matrixWorldAutoUpdate) this.scene.updateMatrixWorld();

    if (this.composer && this._composerErrorCount < 3) {
      try {
        this.composer.render();
      } catch (error) {
        this._composerErrorCount++;
        console.error(`Composer error #${this._composerErrorCount}, falling back:`, error);
        if (this._composerErrorCount >= 3) {
          console.warn('⚠ Composer disabled permanently — using direct rendering');
          this.composer = null;
        }
        // Reset render target to screen before fallback render
        this.renderer.setRenderTarget(null);
        this.renderer.render(this.scene, this.camera);
      }
    } else {
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene, this.camera);
    }
  }

  onWindowResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = this.renderer.getPixelRatio();
    
    if (this.composer) {
      this.composer.setSize(w, h);
    }
    if (this.passes.ssao) {
      this.passes.ssao.uniforms.size.value.set(w * pr, h * pr);
      this.passes.ssao.uniforms.cameraNear.value = this.camera.near;
      this.passes.ssao.uniforms.cameraFar.value = this.camera.far;
    }
    if (this.passes.bloom) {
      this.passes.bloom.resolution.set(w, h);
    }
    if (this.passes.fxaa) {
      this.passes.fxaa.uniforms.resolution.value.set(1.0 / (w * pr), 1.0 / (h * pr));
    }
    if (this.passes.smaa) {
      this.passes.smaa.setSize(w * pr, h * pr);
    }
  }

  // ---- Public API for runtime tweaking ----
  updateBloom(strength, radius, threshold) {
    if (this.passes.bloom) {
      this.passes.bloom.strength = strength;
      this.passes.bloom.radius = radius;
      this.passes.bloom.threshold = threshold;
    }
  }

  updateColorGrading(saturation, brightness, contrast, warmth) {
    if (this.passes.colorCorrection) {
      const u = this.passes.colorCorrection.uniforms;
      u.saturation.value = saturation;
      u.brightness.value = brightness;
      u.contrast.value = contrast;
      u.warmth.value = warmth;
    }
  }

  updateSSAO(radius, intensity) {
    if (this.passes.ssao) {
      this.passes.ssao.uniforms.radius.value = radius;
      this.passes.ssao.uniforms.intensity.value = intensity;
    }
  }

  getComposer() {
    return this.composer;
  }

  // ---- Resolution Scale (50% to 100%) ----
  setResolutionScale(scale) {
    const clamped = Math.max(0.5, Math.min(1.0, scale));
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * clamped);
    this.onWindowResize();
    console.log(`✓ Resolution scale set to ${Math.round(clamped * 100)}%`);
  }

  // ---- Toggle individual post-processing passes ----
  togglePass(passName, enabled) {
    const pass = this.passes[passName];
    if (pass) {
      pass.enabled = enabled;
      console.log(`✓ ${passName} pass ${enabled ? 'enabled' : 'disabled'}`);
    }
  }

  // ---- Time of Day (0 = sunrise, 0.5 = noon, 1.0 = sunset) ----
  setTimeOfDay(t) {
    if (!this.sunLight) return;
    const clamped = Math.max(0, Math.min(1, t));
    
    // Sun angle: low at sunrise/sunset, high at noon
    const elevation = Math.sin(clamped * Math.PI) * 200 + 20;
    const azimuth = (clamped - 0.5) * 400;
    this.sunLight.position.set(azimuth, 100, elevation);
    
    // Color temperature: warm orange at edges, white at noon
    const warmth = 1.0 - Math.sin(clamped * Math.PI);
    const r = 1.0;
    const g = 0.7 + (1.0 - warmth) * 0.3;
    const b = 0.3 + (1.0 - warmth) * 0.7;
    this.sunLight.color.setRGB(r, g, b);
    
    // Intensity: dimmer at horizon, brighter at noon
    this.sunLight.intensity = 0.8 + Math.sin(clamped * Math.PI) * 1.5;
    
    // Exposure follows sun
    this.renderer.toneMappingExposure = 0.7 + Math.sin(clamped * Math.PI) * 0.6;
  }
}
