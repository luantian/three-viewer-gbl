import {
  AmbientLight,
  AnimationMixer,
  AxesHelper,
  Box3,
  Cache,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  LinearEncoding,
  LoaderUtils,
  LoadingManager,
  PMREMGenerator,
  PerspectiveCamera,
  REVISION,
  Scene,
  SkeletonHelper,
  Vector2,
  Vector3,
  WebGLRenderer,
  sRGBEncoding,
  Plane,
  PlaneHelper,
  Group,
  Color,
  PlaneGeometry,
  MeshBasicMaterial,
  AlwaysStencilFunc,
  BackSide,
  IncrementWrapStencilOp,
  Mesh,
  FrontSide,
  DecrementWrapStencilOp,
  Raycaster,
  MeshStandardMaterial,
  NotEqualStencilFunc,
  ReplaceStencilOp,
  DoubleSide,
  ShadowMaterial,
  TorusKnotGeometry
} from 'three';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

// import { GUI } from 'dat.gui';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';

import { environments } from '../assets/environment/index.js';
import { createBackground } from '../lib/three-vignette.js';

const DEFAULT_CAMERA = '[default]';

const MANAGER = new LoadingManager();
const THREE_PATH = `https://unpkg.com/three@0.${REVISION}.x`
const DRACO_LOADER = new DRACOLoader(MANAGER).setDecoderPath(`${THREE_PATH}/examples/js/libs/draco/gltf/`);
const KTX2_LOADER = new KTX2Loader(MANAGER).setTranscoderPath(`${THREE_PATH}/examples/js/libs/basis/`);

const IS_IOS = isIOS();

const zks = ['ZK001', 'ZK002', 'ZK003', 'ZK004', 'ZK101', 'ZK102', 'ZK103', 'ZK104', 'ZK302', 'ZK304', 'ZK401', 'ZK501', 'ZK502', 'ZK504', 'ZK701-1', 'ZK701', 'ZK702', 'ZK703', 'ZK801', 'ZK901', 'ZK902', 'ZK903-1', 'ZK903', 'ZK905', 'ZK1101', 'ZK1103', 'ZK1105', 'ZKJ701-1', 'ZKJ701', 'ZKJ903']

// glTF texture types. `envMap` is deliberately omitted, as it's used internally
// by the loader but not part of the glTF format.
const MAP_NAMES = [
  'map',
  'aoMap',
  'emissiveMap',
  'glossinessMap',
  'metalnessMap',
  'normalMap',
  'roughnessMap',
  'specularMap',
];

const Preset = { ASSET_GENERATOR: 'assetgenerator' };

Cache.enabled = true;

export class Viewer {

  constructor(el, options) {
    this.el = el;
    this.options = options;

    this.lights = [];
    this.content = null;
    this.mixer = null;
    this.clips = [];
    this.gui = null;

    this.state = {
      environment: options.preset === Preset.ASSET_GENERATOR
        ? environments.find((e) => e.id === 'footprint-court').name
        : environments[1].name,
      background: false,
      playbackSpeed: 1.0,
      actionStates: {},
      camera: DEFAULT_CAMERA,
      wireframe: false,
      skeleton: false,
      grid: false,

      // Lights
      addLights: true,
      exposure: 1.0,
      textureEncoding: 'sRGB',
      ambientIntensity: 0.3,
      ambientColor: 0xFFFFFF,
      directIntensity: 0.8 * Math.PI, // TODO(#116)
      directColor: 0xFFFFFF,
      bgColor1: '#12287A',
      bgColor2: '#353535'
    };

    this.prevTime = 0;

    this.stats = new Stats();
    this.stats.dom.height = '48px';
    [].forEach.call(this.stats.dom.children, (child) => (child.style.display = ''));

    this.scene = new Scene();

    const fov = options.preset === Preset.ASSET_GENERATOR
      ? 0.8 * 180 / Math.PI
      : 60;
    this.defaultCamera = new PerspectiveCamera(fov, el.clientWidth / el.clientHeight, 0.01, 1000);
    this.activeCamera = this.defaultCamera;
    this.scene.add(this.defaultCamera);

    this.renderer = window.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.physicallyCorrectLights = true;
    this.renderer.outputEncoding = sRGBEncoding;
    this.renderer.setClearColor(0x12287A);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(el.clientWidth, el.clientHeight);

    this.pmremGenerator = new PMREMGenerator(this.renderer);
    this.pmremGenerator.compileEquirectangularShader();

    this.controls = new OrbitControls(this.defaultCamera, this.renderer.domElement);
    this.controls.autoRotate = false;
    this.controls.autoRotateSpeed = -10;
    this.controls.screenSpacePanning = true;

    this.vignette = createBackground({
      aspect: this.defaultCamera.aspect,
      grainScale: IS_IOS ? 0 : 0.001, // mattdesl/three-vignette-background#1
      colors: [this.state.bgColor1, this.state.bgColor2]
    });
    this.vignette.name = 'Vignette';
    this.vignette.renderOrder = -1;

    this.el.appendChild(this.renderer.domElement);

    this.cameraCtrl = null;
    this.cameraFolder = null;
    this.animFolder = null;
    this.animCtrls = [];
    this.morphFolder = null;
    this.morphCtrls = [];
    this.skeletonHelpers = [];
    this.gridHelper = null;
    this.axesHelper = null;

    this.addAxesHelper();
    // this.addGUI();
    // if (options.kiosk) this.gui.close();

    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
    window.addEventListener('resize', this.resize.bind(this), false);
  }

  animate(time) {

    requestAnimationFrame(this.animate);

    const dt = (time - this.prevTime) / 1000;

    this.controls.update();
    this.stats.update();
    this.mixer && this.mixer.update(dt);
    this.render();

    this.prevTime = time;

  }

  render() {

    this.renderer.render(this.scene, this.activeCamera);
    if (this.state.grid) {
      this.axesCamera.position.copy(this.defaultCamera.position)
      this.axesCamera.lookAt(this.axesScene.position)
      this.axesRenderer.render(this.axesScene, this.axesCamera);
    }
  }

  resize() {

    const { clientHeight, clientWidth } = this.el.parentElement;

    this.defaultCamera.aspect = clientWidth / clientHeight;
    this.defaultCamera.updateProjectionMatrix();
    this.vignette.style({ aspect: this.defaultCamera.aspect });
    this.renderer.setSize(clientWidth, clientHeight);

    this.axesCamera.aspect = this.axesDiv.clientWidth / this.axesDiv.clientHeight;
    this.axesCamera.updateProjectionMatrix();
    this.axesRenderer.setSize(this.axesDiv.clientWidth, this.axesDiv.clientHeight);
  }

  load(url, rootPath, assetMap) {

    const baseURL = LoaderUtils.extractUrlBase(url);

    // Load.
    return new Promise((resolve, reject) => {

      // Intercept and override relative URLs.
      MANAGER.setURLModifier((url, path) => {

        // URIs in a glTF file may be escaped, or not. Assume that assetMap is
        // from an un-escaped source, and decode all URIs before lookups.
        // See: https://github.com/donmccurdy/three-gltf-viewer/issues/146
        const normalizedURL = rootPath + decodeURI(url)
          .replace(baseURL, '')
          .replace(/^(\.?\/)/, '');

        if (assetMap.has(normalizedURL)) {
          const blob = assetMap.get(normalizedURL);
          const blobURL = URL.createObjectURL(blob);
          blobURLs.push(blobURL);
          return blobURL;
        }

        return (path || '') + url;

      });

      const loader = new GLTFLoader(MANAGER)
        .setCrossOrigin('anonymous')
        .setDRACOLoader(DRACO_LOADER)
        .setKTX2Loader(KTX2_LOADER.detectSupport(this.renderer))
        .setMeshoptDecoder(MeshoptDecoder);

      const blobURLs = [];

      loader.load(url, (gltf) => {

        const scene = gltf.scene || gltf.scenes[0];
        const clips = gltf.animations || [];

        if (!scene) {
          // Valid, but not supported by this viewer.
          throw new Error(
            'This model contains no scene, and cannot be viewed here. However,'
            + ' it may contain individual 3D resources.'
          );
        }

        this.setContent(gltf, clips);

        blobURLs.forEach(URL.revokeObjectURL);

        // See: https://github.com/google/draco/issues/349
        // DRACOLoader.releaseDecoderModule();

        resolve(gltf);

      }, undefined, reject);

    });

  }

  /**
   * @param {THREE.Object3D} object
   * @param {Array<THREE.AnimationClip} clips
   */
  setContent(gltf, clips) {

    const object = gltf.scene

    console.log('object', object)

    const meshes = object.children;

    this.copyPosition = meshes.map(item => item.position)

    this.clear();

    const box = new Box3().setFromObject(object);
    const size = box.getSize(new Vector3()).length();
    const center = box.getCenter(new Vector3());

    this.controls.reset();

    object.position.x += (object.position.x - center.x);
    object.position.y += (object.position.y - center.y);
    object.position.z += (object.position.z - center.z);
    this.controls.maxDistance = size * 10;
    this.defaultCamera.near = size / 100;
    this.defaultCamera.far = size * 100;
    this.defaultCamera.updateProjectionMatrix();

    if (this.options.cameraPosition) {

      this.defaultCamera.position.fromArray(this.options.cameraPosition);
      this.defaultCamera.lookAt(new Vector3());

    } else {

      this.defaultCamera.position.copy(center);
      this.defaultCamera.position.x += size / 2.0;
      this.defaultCamera.position.y += size / 5.0;
      this.defaultCamera.position.z += size / 2.0;
      this.defaultCamera.lookAt(center);

    }

    this.setCamera(DEFAULT_CAMERA);

    this.axesCamera.position.copy(this.defaultCamera.position)
    this.axesCamera.lookAt(this.axesScene.position)
    this.axesCamera.near = size / 100;
    this.axesCamera.far = size * 100;
    this.axesCamera.updateProjectionMatrix();
    this.axesCorner.scale.set(size, size, size);

    this.controls.saveState();

    this.scene.add(object);
    this.content = object;

    this.state.addLights = true;

    this.content.traverse((node) => {
      if (node.isLight) {
        this.state.addLights = false;
      } else if (node.isMesh) {
        // TODO(https://github.com/mrdoob/three.js/pull/18235): Clean up.
        node.material.depthWrite = !node.material.transparent;
      }
    });

    this.setClips(clips);
    
    this.updateLights();
    // this.updateGUI();
    this.updateEnvironment();
    this.updateTextureEncoding();
    this.updateDisplay();

    window.content = this.content;
    console.info('[glTF Viewer] THREE.Scene exported as `window.content`.');
    this.printGraph(this.content);

    // custom start

    this.initClips(gltf, object)

    setOnClick.call(this)

    // custom end

  }

  printGraph(node) {

    console.group(' <' + node.type + '> ' + node.name);
    node.children.forEach((child) => this.printGraph(child));
    console.groupEnd();

  }

  /**
   * @param {Array<THREE.AnimationClip} clips
   */
  setClips(clips) {
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.mixer.getRoot());
      this.mixer = null;
    }

    this.clips = clips;
    if (!clips.length) return;

    this.mixer = new AnimationMixer(this.content);
  }

  playAllClips() {
    this.clips.forEach((clip) => {
      this.mixer.clipAction(clip).reset().play();
      this.state.actionStates[clip.name] = true;
    });
  }

  /**
   * @param {string} name
   */
  setCamera(name) {
    if (name === DEFAULT_CAMERA) {
      this.controls.enabled = true;
      this.activeCamera = this.defaultCamera;
    } else {
      this.controls.enabled = false;
      this.content.traverse((node) => {
        if (node.isCamera && node.name === name) {
          this.activeCamera = node;
        }
      });
    }
  }

  updateTextureEncoding() {
    const encoding = this.state.textureEncoding === 'sRGB'
      ? sRGBEncoding
      : LinearEncoding;
    traverseMaterials(this.content, (material) => {
      if (material.map) material.map.encoding = encoding;
      if (material.emissiveMap) material.emissiveMap.encoding = encoding;
      if (material.map || material.emissiveMap) material.needsUpdate = true;
    });
  }

  updateLights() {
    const state = this.state;
    const lights = this.lights;

    if (state.addLights && !lights.length) {
      this.addLights();
    } else if (!state.addLights && lights.length) {
      this.removeLights();
    }

    this.renderer.toneMappingExposure = state.exposure;

    if (lights.length === 2) {
      lights[0].intensity = state.ambientIntensity;
      lights[0].color.setHex(state.ambientColor);
      lights[1].intensity = state.directIntensity;
      lights[1].color.setHex(state.directColor);
    }
  }

  addLights() {
    const state = this.state;

    if (this.options.preset === Preset.ASSET_GENERATOR) {
      const hemiLight = new HemisphereLight();
      hemiLight.name = 'hemi_light';
      this.scene.add(hemiLight);
      this.lights.push(hemiLight);
      return;
    }

    const light1 = new AmbientLight(state.ambientColor, state.ambientIntensity);
    light1.name = 'ambient_light';
    this.defaultCamera.add(light1);

    const light2 = new DirectionalLight(state.directColor, state.directIntensity);
    light2.position.set(0.5, 0, 0.866); // ~60º
    light2.name = 'main_light';
    this.defaultCamera.add(light2);

    this.lights.push(light1, light2);
  }

  removeLights() {

    this.lights.forEach((light) => light.parent.remove(light));
    this.lights.length = 0;

  }

  updateEnvironment() {

    const environment = environments.filter((entry) => entry.name === this.state.environment)[0];

    this.getCubeMapTexture(environment).then(({ envMap }) => {

      if ((!envMap || !this.state.background) && this.activeCamera === this.defaultCamera) {
        this.scene.add(this.vignette);
      } else {
        this.scene.remove(this.vignette);
      }

      this.scene.environment = envMap;
      this.scene.background = this.state.background ? envMap : null;

    });

  }

  getCubeMapTexture(environment) {
    const { path } = environment;

    // no envmap
    if (!path) return Promise.resolve({ envMap: null });

    return new Promise((resolve, reject) => {

      new RGBELoader()
        // .setDataType(UnsignedByteType)
        .load( path, ( texture ) => {

          const envMap = this.pmremGenerator.fromEquirectangular(texture).texture;
          this.pmremGenerator.dispose();

          resolve({ envMap });

        }, undefined, reject);

    });

  }

  updateDisplay() {
    if (this.skeletonHelpers.length) {
      this.skeletonHelpers.forEach((helper) => this.scene.remove(helper));
    }

    traverseMaterials(this.content, (material) => {
      material.wireframe = this.state.wireframe;
    });

    this.content.traverse((node) => {
      if (node.isMesh && node.skeleton && this.state.skeleton) {
        const helper = new SkeletonHelper(node.skeleton.bones[0].parent);
        helper.material.linewidth = 3;
        this.scene.add(helper);
        this.skeletonHelpers.push(helper);
      }
    });

    if (this.state.grid !== Boolean(this.gridHelper)) {
      if (this.state.grid) {
        this.gridHelper = new GridHelper();
        this.axesHelper = new AxesHelper();
        this.axesHelper.renderOrder = 999;
        this.axesHelper.onBeforeRender = (renderer) => renderer.clearDepth();
        this.scene.add(this.gridHelper);
        this.scene.add(this.axesHelper);
      } else {
        this.scene.remove(this.gridHelper);
        this.scene.remove(this.axesHelper);
        this.gridHelper = null;
        this.axesHelper = null;
        this.axesRenderer.clear();
      }
    }
  }

  updateBackground() {
    this.vignette.style({ colors: [this.state.bgColor1, this.state.bgColor2] });
  }

  /**
   * Adds AxesHelper.
   *
   * See: https://stackoverflow.com/q/16226693/1314762
   */
  addAxesHelper() {
    this.axesDiv = document.createElement('div');
    this.el.appendChild(this.axesDiv);
    this.axesDiv.classList.add('axes');

    const { clientWidth, clientHeight } = this.axesDiv;

    this.axesScene = new Scene();
    this.axesCamera = new PerspectiveCamera(50, clientWidth / clientHeight, 0.1, 10);
    this.axesScene.add(this.axesCamera);

    this.axesRenderer = new WebGLRenderer({ alpha: true });
    this.axesRenderer.setPixelRatio(window.devicePixelRatio);
    this.axesRenderer.setSize(this.axesDiv.clientWidth, this.axesDiv.clientHeight);

    this.axesCamera.up = this.defaultCamera.up;

    this.axesCorner = new AxesHelper(5);
    this.axesScene.add(this.axesCorner);
    this.axesDiv.appendChild(this.axesRenderer.domElement);
  }

  // addGUI () {

  //   const gui = this.gui = new GUI({autoPlace: false, width: 260, hideable: true});

  //   // Display controls.
  //   const dispFolder = gui.addFolder('Display');
  //   const envBackgroundCtrl = dispFolder.add(this.state, 'background');
  //   envBackgroundCtrl.onChange(() => this.updateEnvironment());
  //   const wireframeCtrl = dispFolder.add(this.state, 'wireframe');
  //   wireframeCtrl.onChange(() => this.updateDisplay());
  //   const skeletonCtrl = dispFolder.add(this.state, 'skeleton');
  //   skeletonCtrl.onChange(() => this.updateDisplay());
  //   const gridCtrl = dispFolder.add(this.state, 'grid');
  //   gridCtrl.onChange(() => this.updateDisplay());
  //   dispFolder.add(this.controls, 'autoRotate');
  //   dispFolder.add(this.controls, 'screenSpacePanning');
  //   const bgColor1Ctrl = dispFolder.addColor(this.state, 'bgColor1');
  //   const bgColor2Ctrl = dispFolder.addColor(this.state, 'bgColor2');
  //   bgColor1Ctrl.onChange(() => this.updateBackground());
  //   bgColor2Ctrl.onChange(() => this.updateBackground());

  //   // Lighting controls.
  //   const lightFolder = gui.addFolder('Lighting');
  //   const encodingCtrl = lightFolder.add(this.state, 'textureEncoding', ['sRGB', 'Linear']);
  //   encodingCtrl.onChange(() => this.updateTextureEncoding());
  //   lightFolder.add(this.renderer, 'outputEncoding', {sRGB: sRGBEncoding, Linear: LinearEncoding})
  //     .onChange(() => {
  //       this.renderer.outputEncoding = Number(this.renderer.outputEncoding);
  //       traverseMaterials(this.content, (material) => {
  //         material.needsUpdate = true;
  //       });
  //     });
  //   const envMapCtrl = lightFolder.add(this.state, 'environment', environments.map((env) => env.name));
  //   envMapCtrl.onChange(() => this.updateEnvironment());
  //   [
  //     lightFolder.add(this.state, 'exposure', 0, 2),
  //     lightFolder.add(this.state, 'addLights').listen(),
  //     lightFolder.add(this.state, 'ambientIntensity', 0, 2),
  //     lightFolder.addColor(this.state, 'ambientColor'),
  //     lightFolder.add(this.state, 'directIntensity', 0, 4), // TODO(#116)
  //     lightFolder.addColor(this.state, 'directColor')
  //   ].forEach((ctrl) => ctrl.onChange(() => this.updateLights()));

  //   // Animation controls.
  //   this.animFolder = gui.addFolder('Animation');
  //   this.animFolder.domElement.style.display = 'none';
  //   const playbackSpeedCtrl = this.animFolder.add(this.state, 'playbackSpeed', 0, 1);
  //   playbackSpeedCtrl.onChange((speed) => {
  //     if (this.mixer) this.mixer.timeScale = speed;
  //   });
  //   this.animFolder.add({playAll: () => this.playAllClips()}, 'playAll');

  //   // Morph target controls.
  //   this.morphFolder = gui.addFolder('Morph Targets');
  //   this.morphFolder.domElement.style.display = 'none';

  //   // Camera controls.
  //   this.cameraFolder = gui.addFolder('Cameras');
  //   this.cameraFolder.domElement.style.display = 'none';

  //   // Stats.
  //   const perfFolder = gui.addFolder('Performance');
  //   const perfLi = document.createElement('li');
  //   this.stats.dom.style.position = 'static';
  //   perfLi.appendChild(this.stats.dom);
  //   perfLi.classList.add('gui-stats');
  //   perfFolder.__ul.appendChild( perfLi );

  //   const guiWrap = document.createElement('div');
  //   this.el.appendChild( guiWrap );
  //   guiWrap.classList.add('gui-wrap');
  //   guiWrap.appendChild(gui.domElement);
  //   gui.open();

  // }

  // updateGUI () {
  //   this.cameraFolder.domElement.style.display = 'none';

  //   this.morphCtrls.forEach((ctrl) => ctrl.remove());
  //   this.morphCtrls.length = 0;
  //   this.morphFolder.domElement.style.display = 'none';

  //   this.animCtrls.forEach((ctrl) => ctrl.remove());
  //   this.animCtrls.length = 0;
  //   this.animFolder.domElement.style.display = 'none';

  //   const cameraNames = [];
  //   const morphMeshes = [];
  //   this.content.traverse((node) => {
  //     if (node.isMesh && node.morphTargetInfluences) {
  //       morphMeshes.push(node);
  //     }
  //     if (node.isCamera) {
  //       node.name = node.name || `VIEWER__camera_${cameraNames.length + 1}`;
  //       cameraNames.push(node.name);
  //     }
  //   });

  //   if (cameraNames.length) {
  //     this.cameraFolder.domElement.style.display = '';
  //     if (this.cameraCtrl) this.cameraCtrl.remove();
  //     const cameraOptions = [DEFAULT_CAMERA].concat(cameraNames);
  //     this.cameraCtrl = this.cameraFolder.add(this.state, 'camera', cameraOptions);
  //     this.cameraCtrl.onChange((name) => this.setCamera(name));
  //   }

  //   if (morphMeshes.length) {
  //     this.morphFolder.domElement.style.display = '';
  //     morphMeshes.forEach((mesh) => {
  //       if (mesh.morphTargetInfluences.length) {
  //         const nameCtrl = this.morphFolder.add({name: mesh.name || 'Untitled'}, 'name');
  //         this.morphCtrls.push(nameCtrl);
  //       }
  //       for (let i = 0; i < mesh.morphTargetInfluences.length; i++) {
  //         const ctrl = this.morphFolder.add(mesh.morphTargetInfluences, i, 0, 1, 0.01).listen();
  //         Object.keys(mesh.morphTargetDictionary).forEach((key) => {
  //           if (key && mesh.morphTargetDictionary[key] === i) ctrl.name(key);
  //         });
  //         this.morphCtrls.push(ctrl);
  //       }
  //     });
  //   }

  //   if (this.clips.length) {
  //     this.animFolder.domElement.style.display = '';
  //     const actionStates = this.state.actionStates = {};
  //     this.clips.forEach((clip, clipIndex) => {
  //       clip.name = `${clipIndex + 1}. ${clip.name}`;

  //       // Autoplay the first clip.
  //       let action;
  //       if (clipIndex === 0) {
  //         actionStates[clip.name] = true;
  //         action = this.mixer.clipAction(clip);
  //         action.play();
  //       } else {
  //         actionStates[clip.name] = false;
  //       }

  //       // Play other clips when enabled.
  //       const ctrl = this.animFolder.add(actionStates, clip.name).listen();
  //       ctrl.onChange((playAnimation) => {
  //         action = action || this.mixer.clipAction(clip);
  //         action.setEffectiveTimeScale(1);
  //         playAnimation ? action.play() : action.stop();
  //       });
  //       this.animCtrls.push(ctrl);
  //     });
  //   }
  // }

  clear() {

    if (!this.content) return;

    this.scene.remove(this.content);

    // dispose geometry
    this.content.traverse((node) => {

      if (!node.isMesh) return;

      node.geometry.dispose();

    });

    // dispose textures
    traverseMaterials(this.content, (material) => {

      MAP_NAMES.forEach((map) => {

        if (material[map]) material[map].dispose();

      });

    });

  }

  initClips(gltf, scene) {

    // let scene = gltf.scene || gltf.scenes[0];

    console.log('______scene______', scene)

    scene.visible = false
    let camera, renderer, stats, object;
    let planes, planeObjects, planeHelpers;

    const params = {

      planeX: {

        数值: 1,
        取反: false,
        显示截面: false

      },
      planeY: {

        数值: 1,
        取反: false,
        显示截面: false

      },
      planeZ: {

        数值: 1,
        取反: false,
        显示截面: false

      }

    };

    

    // planes = [
    //   new Plane(new Vector3(- 1, 0, 0), 0),
    //   new Plane(new Vector3(0, - 1, 0), 0),
    //   new Plane(new Vector3(0, 0, - 1), 0)
    // ];

    planes = [
      new Plane(new Vector3(-1, 0 ,0), 1),
      new Plane(new Vector3(0, - 1, 0), 1),
      new Plane(new Vector3(0, 0, - 1), 1)
    ];

    planeHelpers = planes.map(p => new PlaneHelper(p, 2, 0xffffff));
    planeHelpers.forEach(ph => {

      ph.visible = false;
      this.scene.add(ph);

    });

    object = new Group();

    this.scene.add(object)

    planeObjects = [];

    // const geometry = new TorusKnotGeometry( 0.4, 0.15, 220, 60 );

    const geometries = scene.children

    // const geometry = geometries[0].geometry
    // const material = geometries[0].material

    // const planeGeom = new PlaneGeometry(4, 4);

    // for (let i = 0; i < 3; i++) {

    //   const plane = planes[i];
    //   const stencilGroup = createPlaneStencilGroup(geometries, plane, i + 1);
    //   // object.add(stencilGroup);
    //   // this.scene.add(stencilGroup)
    // }
    this.clippedColorFrontMeshes = []

    for (let i = 0; i < geometries.length; i++) {
      const geometry = geometries[i].geometry
      const material = geometries[i].material

      const clippedColorFrontGeometry = geometry.clone()
      const clippedColorFrontMaterial = material.clone()

      clippedColorFrontMaterial.clippingPlanes = planes

      // add the color
      const clippedColorFrontMesh = new Mesh( clippedColorFrontGeometry, clippedColorFrontMaterial );
      clippedColorFrontMesh.name = geometries[i].name
      clippedColorFrontMesh.position.set(this.copyPosition[i].x, this.copyPosition[i].y, this.copyPosition[i].z)
      console.log('clippedColorFrontMesh', clippedColorFrontMesh)
      this.clippedColorFrontMeshes.push(clippedColorFrontMesh)
      // clippedColorFrontMesh.castShadow = true;
      // clippedColorFrontMesh.renderOrder = 6;
      object.add( clippedColorFrontMesh );

    }

    console.log('___object___', object)

    // GUI
    const gui = new GUI();
    let xqufan = false
    let yqufan = false
    let zqufan = false

    const planeX = gui.addFolder('X面');
    planeX.add(params.planeX, '显示截面').onChange(v => planeHelpers[0].visible = v);
    planeX.add(params.planeX, '数值').min(- 1).max(1).onChange(d => planes[0].constant = d);
    planeX.add(params.planeX, '取反').onChange(() => {
      if (!xqufan) planes[0].negate();
      params.planeX.constant = planes[0].constant;
      xqufan = false
    });
    planeX.open();

    const planeY = gui.addFolder('Y面');
    planeY.add(params.planeY, '显示截面').onChange(v => planeHelpers[1].visible = v);
    planeY.add(params.planeY, '数值').min(- 1).max(1).onChange(d => planes[1].constant = d);
    planeY.add(params.planeY, '取反').onChange(() => {
      if (!yqufan)planes[1].negate();
      params.planeY.constant = planes[1].constant;
      yqufan = false
    });
    planeY.open();

    const planeZ = gui.addFolder('Z面');
    planeZ.add(params.planeZ, '显示截面').onChange(v => planeHelpers[2].visible = v);
    planeZ.add(params.planeZ, '数值').min(- 1).max(1).onChange(d => planes[2].constant = d);
    planeZ.add(params.planeZ, '取反').onChange(() => {
      if (!zqufan)planes[2].negate();
      params.planeZ.constant = planes[2].constant;
      zqufan = false
    });
    planeZ.open();

    gui.add({'复位': () => {
      xqufan = true
      yqufan = true
      zqufan = true
      gui.reset()
    }}, '复位')

    gui.add({'全屏': () => {
      const docElm = document.querySelector('body')
      console.log('docElm', docElm)
      if (docElm.requestFullscreen) {
        docElm.requestFullscreen()
      } else if (docElm.msRequestFullscreen) {
        docElm.msRequestFullscreen()
      } else if (docElm.mozRequestFullScreen) {
        docElm.mozRequestFullScreen()
      } else if (docElm.webkitRequestFullScreen) {
        docElm.webkitRequestFullScreen()
      }
    }}, '全屏')

    gui.add({'取消全屏': () => {
      if (document.exitFullscreen) {
        document.exitFullscreen()
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen()
      } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen()
      } else if (document.webkitCancelFullScreen) {
        document.webkitCancelFullScreen()
      }
    }}, '取消全屏')

    this.renderer.localClippingEnabled = true

    document.querySelector('.lil-gui .title').innerHTML = '控制器'

  }

};

function setOnClick() {
  // let scene = gltf.scene || gltf.scenes[0];
  const raycaster = new Raycaster()
    const pointer = new Vector2()

    const This = this
    let prevClickObject = null
    let initColor = null
    function onMouseClick(event) {
      //将鼠标点击位置的屏幕坐标转换成threejs中的标准坐标

      let getBoundingClientRect = This.el.getBoundingClientRect()

      pointer.x = ((event.clientX - getBoundingClientRect .left) / This.el.offsetWidth) * 2 - 1;
      pointer.y = -((event.clientY - getBoundingClientRect .top) / This.el.offsetHeight) * 2 + 1;

      // mouse.x = (event.clientX / window.innerWidth) * 2 - 1
      // mouse.y = (event.clientY / window.innerHeight) * 2 + 1

      // 通过鼠标点的位置和当前相机的矩阵计算出raycaster
      raycaster.setFromCamera( pointer, This.activeCamera );
  
      // console.log('gltf', gltf)
      
      // console.log('scene.children', scene.children)

      var intersects = raycaster.intersectObjects( This.clippedColorFrontMeshes, false );

      console.log('intersects', intersects)

      if (intersects.length > 0) {
        
        console.log('intersects[0].object', intersects[0].object.name)
        console.log('intersects', intersects)

        const meshObject = intersects[0].object
        
        const name = meshObject.name
        if (zks.includes(name)) {
          if (prevClickObject) {
            prevClickObject.material.color.set(initColor)
          } else {
            initColor = meshObject.material.color.getHex()
            console.log(initColor)
          }
          meshObject.material.color.set(0x0101DF)
          prevClickObject = meshObject
          const fullScreen = document.querySelector('#fullscreen')
          const zkWrap = document.querySelector('#zk-wrap')
          const oImg = zkWrap.querySelector('img')
          fullScreen.style.display = 'block'
          oImg.src = `/assets/img/${name}.png`
        }
      }
  
      
    }
    window.addEventListener( 'click', onMouseClick, false );
    const fullScreen = document.querySelector('#fullscreen')
    fullScreen.onclick = () => {
      fullScreen.style.display = 'none'
      if (prevClickObject) {
        prevClickObject.material.color.set(new Color(initColor))
      }
    }
}

function traverseMaterials(object, callback) {
  object.traverse((node) => {
    if (!node.isMesh) return;
    const materials = Array.isArray(node.material)
      ? node.material
      : [node.material];
    materials.forEach(callback);
  });
}

// https://stackoverflow.com/a/9039885/1314762
function isIOS() {
  return [
    'iPad Simulator',
    'iPhone Simulator',
    'iPod Simulator',
    'iPad',
    'iPhone',
    'iPod'
  ].includes(navigator.platform)
    // iPad on iOS 13 detection
    || (navigator.userAgent.includes('Mac') && 'ontouchend' in document);
}

function createPlaneStencilGroup(meshes, plane, renderOrder) {

  const group = new Group();
  const baseMat = new MeshBasicMaterial();

  let geometry = null

  for (let i = 0; i < meshes.length; i++) {

    geometry = meshes[i].geometry

    baseMat.depthWrite = false;
    baseMat.depthTest = false;
    baseMat.colorWrite = false;
    baseMat.stencilWrite = true;
    baseMat.stencilFunc = AlwaysStencilFunc;

    // back faces
    const mat0 = baseMat.clone();
    // console.log('mat0', mat0)
    mat0.name = 'clone0'
    mat0.side = BackSide;
    mat0.clippingPlanes = [plane];
    mat0.stencilFail = IncrementWrapStencilOp;
    mat0.stencilZFail = IncrementWrapStencilOp;
    mat0.stencilZPass = IncrementWrapStencilOp;

    const mesh0 = new Mesh(geometry, mat0);
    mesh0.renderOrder = renderOrder + ((i + 1) * 10);
    group.add(mesh0);

    // front faces
    const mat1 = baseMat.clone();
    mat1.name = 'clone1'
    mat1.side = FrontSide;
    mat1.clippingPlanes = [plane];
    mat1.stencilFail = DecrementWrapStencilOp;
    mat1.stencilZFail = DecrementWrapStencilOp;
    mat1.stencilZPass = DecrementWrapStencilOp;

    const mesh1 = new Mesh(geometry, mat1);
    mesh1.renderOrder = renderOrder + ((i + 1) * 100);

    group.add(mesh1);
  }

  console.log('createPlaneStencilGroup', group)
  
  return group;

}