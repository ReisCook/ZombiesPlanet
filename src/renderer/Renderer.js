// src/renderer/Renderer.js
import {
    WebGLRenderer,
    Scene,
    PCFSoftShadowMap,
    FogExp2,
    Color,
    PlaneGeometry,
    MeshStandardMaterial,
    Mesh,
    BoxGeometry,
    SphereGeometry, // Add this import
    RepeatWrapping,
    Vector2,
    Vector3
} from 'three';
import { Lighting } from './Lighting.js';
import { Skybox } from './Skybox.js';
import { GroundPlane, BoxObstacle } from '../physics/PhysicsBody.js';
import { PlanetBody } from '../physics/PlanetBody.js'; // Add this import

export class Renderer {
    constructor(engine) {
        this.engine = engine;
        
        // Create renderer and scene
        this.renderer = null;
        this.scene = new Scene();
        
        // Scene objects
        this.mapObjects = [];
        
        // Subsystems
        this.lighting = null;
        this.skybox = null;
    }
    
    init() {
        // Create Three.js renderer
        this.renderer = new WebGLRenderer({
            antialias: true,
            powerPreference: 'high-performance'
        });
        
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = PCFSoftShadowMap;
        
        // Add to DOM
        document.getElementById('game-container').appendChild(this.renderer.domElement);
        
        // Initialize subsystems
        this.lighting = new Lighting(this);
        this.skybox = new Skybox(this);
        
        // Add fog to scene
        this.scene.fog = new FogExp2(0x88aadd, 0.015);
        
        // Handle window resize
        window.addEventListener('resize', this.onResize.bind(this));
        
        console.log('Renderer initialized');
    }
    
    onResize() {
        const width = window.innerWidth;
        const height = window.innerHeight;
        
        this.renderer.setSize(width, height);
    }
    
    render() {
        if (!this.engine.camera || !this.scene) return;
        
        // Render the scene
        this.renderer.render(this.scene, this.engine.camera.camera);
    }
    
    createTerrain(terrainData) {
        // Extract planet radius - fairly small for visible curvature
        const radius = terrainData.radius || 20; 
        
        // Create a sphere geometry with sufficient segments for smoothness
        const geometry = new SphereGeometry(radius, 64, 48);
        
        // Get texture from asset manager
        const textureObj = this.engine.assetManager.getTexture(terrainData.texture);
        if (!textureObj) {
            console.error(`Terrain texture not found: ${terrainData.texture}`);
            return null;
        }
        
        // Configure texture
        textureObj.wrapS = RepeatWrapping;
        textureObj.wrapT = RepeatWrapping;
        textureObj.repeat.set(8, 4); // Adjust texture repeat for sphere
        
        // Create material
        const material = new MeshStandardMaterial({
            map: textureObj,
            roughness: 0.8,
            metalness: 0.2
        });
        
        // Create mesh
        const terrain = new Mesh(geometry, material);
        terrain.receiveShadow = true;
        
        // Add to scene
        this.scene.add(terrain);
        this.mapObjects.push(terrain);
        
        // Store planet data for physics system reference
        this.engine.planetData = {
            radius: radius,
            center: new Vector3(0, 0, 0)
        };
        
        // Create planet physics
        this.createPlanetPhysics(radius);
        
        return {
            mesh: terrain,
            radius: radius
        };
    }
    
    createStructure(structureData) {
        const { type, position, scale, texture, rotation } = structureData;
        
        let mesh = null;
        let physicsBody = null;
        
        // Create mesh based on type
        if (type === 'box') {
            // Create box geometry
            const geometry = new BoxGeometry(scale.x, scale.y, scale.z);
            
            // Get texture
            const textureObj = this.engine.assetManager.getTexture(texture);
            if (!textureObj) {
                console.error(`Structure texture not found: ${texture}`);
                return null;
            }
            
            // Create material
            const material = new MeshStandardMaterial({
                map: textureObj,
                roughness: 0.7,
                metalness: 0.3
            });
            
            // Create mesh
            mesh = new Mesh(geometry, material);
            
            // Apply position and rotation
            mesh.position.set(position.x, position.y, position.z);
            
            if (rotation) {
                mesh.rotation.set(
                    rotation.x || 0,
                    rotation.y || 0,
                    rotation.z || 0
                );
            }
            
            // Setup shadows
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            
            // Add to scene
            this.scene.add(mesh);
            this.mapObjects.push(mesh);
            
            // Create physics body for box
            physicsBody = new BoxObstacle({
                position: new Vector3(position.x, position.y, position.z),
                halfExtents: new Vector3(scale.x / 2, scale.y / 2, scale.z / 2),
                restitution: 0.2,
                friction: 0.5
            });
            
            // Add to physics world
            this.engine.physics.addBody(physicsBody);
        } 
        // Other structure types would be handled here
        
        if (!mesh) {
            return null;
        }
        
        return {
            mesh: mesh,
            physicsBody: physicsBody
        };
    }
    
    clearMapObjects() {
        // Remove all map objects from scene
        for (const object of this.mapObjects) {
            this.scene.remove(object);
            
            // Dispose geometry and materials
            if (object.geometry) {
                object.geometry.dispose();
            }
            
            if (object.material) {
                if (Array.isArray(object.material)) {
                    object.material.forEach(mat => mat.dispose());
                } else {
                    object.material.dispose();
                }
            }
        }
        
        this.mapObjects = [];
    }
    
    async setSkybox(skyboxData) {
        await this.skybox.set(skyboxData);
    }
    // Add helper to Renderer.js
    placeObjectOnPlanet(object, positionVector, planetRadius) {
        // Normalize the position to get direction from center
        const direction = positionVector.clone().normalize();
        
        // Place at proper distance from center
        const finalPosition = direction.multiplyScalar(planetRadius + object.scale.y/2);
        object.position.copy(finalPosition);
        
        // Orient to surface (Y-axis along the radius)
        const upQuat = new Quaternion().setFromUnitVectors(
            new Vector3(0, 1, 0), direction);
        object.quaternion.copy(upQuat);
    }
    // Add this method to the Renderer class - place it after createTerrain
    createPlanetPhysics(radius) {
        // Create planet physics body
        const planetBody = new PlanetBody({
            radius: radius,
            position: new Vector3(0, 0, 0),
            restitution: 0.3,
            friction: 0.8
        });
        
        // Add to physics world
        this.engine.physics.addBody(planetBody);
        
        // Store reference to planetBody for easy access
        this.engine.physics.planetBody = planetBody;
    }
}