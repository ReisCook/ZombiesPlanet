// src/camera/PlayerCamera.js
import { PerspectiveCamera, Vector3, Quaternion, Euler, Matrix4 } from 'three';

export class PlayerCamera {
    constructor(engine) {
        this.engine = engine;
        this.player = engine.player;
        
        // Create camera
        this.camera = new PerspectiveCamera(
            engine.config.fov,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        
        // Camera offset from player position (eye height)
        this.offset = new Vector3(0, engine.config.eyeHeight || 1.7, 0);
        
        // Camera state
        this.position = new Vector3();
        this.target = new Vector3();
        
        // Camera effects
        this.baseFov = engine.config.fov;
        this.currentFov = this.baseFov;
        this.targetFov = this.baseFov;
        this.fovChangeSpeed = 5.0;
        
        // Head bob effect
        this.enableHeadBob = engine.config.enableHeadBob !== undefined ? 
            engine.config.enableHeadBob : true;
        this.bobFrequency = engine.config.bobFrequency || 2.0;
        this.bobAmplitude = engine.config.bobAmplitude || 0.07;
        this.bobTimer = 0;
        this.lastBobPosition = new Vector3();
        
        // Add camera to scene
        engine.renderer.scene.add(this.camera);
        
        // Set as main camera for renderer
        engine.renderer.camera = this.camera;
        
        // Setup resize handling
        window.addEventListener('resize', this.handleResize.bind(this));
    }
    
    handleResize() {
        // Update camera aspect ratio
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
    }
    
    update(deltaTime) {
        if (!this.player) return;
        
        // Calculate camera position based on player's position plus eye height offset
        const worldOffset = this.offset.clone();
        
        // Apply orientation to offset if on a planet
        if (this.engine.physics.planetBody) {
            worldOffset.applyQuaternion(this.player.orientationQuaternion);
        }
        
        // Set camera position
        this.position.copy(this.player.position).add(worldOffset);
        
        // Apply head bob if enabled and player is moving on ground
        if (this.enableHeadBob && this.player.onGround && 
            this.player.velocity.length() > 2.0) {
            this.applyHeadBob(deltaTime);
        }
        
        // Update camera position
        this.camera.position.copy(this.position);
        
        // Calculate camera rotation
        if (this.engine.physics.planetBody) {
            // Planet-oriented camera rotation
            this.updatePlanetOrientedCamera();
        } else {
            // Standard camera rotation
            this.camera.rotation.x = this.player.viewRotation.x;
            this.camera.rotation.y = this.player.viewRotation.y;
            this.camera.rotation.z = 0;
        }
        
        // Update field of view based on sprint state
        this.updateFov(deltaTime);
    }
    
    updatePlanetOrientedCamera() {
        // Create an orthonormal basis for the player's local space on the planet
        const up = this.player.surfaceNormal.clone();
        
        // Create a quaternion that aligns world-up (0,1,0) with the surface normal
        const alignmentQuat = new Quaternion().setFromUnitVectors(
            new Vector3(0, 1, 0), 
            up
        );
        
        // Get the player's view rotation as quaternion
        const viewQuat = new Quaternion().setFromEuler(
            new Euler(this.player.viewRotation.x, this.player.viewRotation.y, 0, 'YXZ')
        );
        
        // First apply alignment to the planet's surface, then apply the view rotation
        const finalQuat = new Quaternion().multiplyQuaternions(alignmentQuat, viewQuat);
        
        // Apply to camera
        this.camera.quaternion.copy(finalQuat);
    }
    
    applyHeadBob(deltaTime) {
        // Update bob timer based on movement speed
        const movementSpeed = this.player.velocity.length();
        const bobSpeed = this.bobFrequency * (movementSpeed / this.player.movement.walkSpeed);
        this.bobTimer += bobSpeed * deltaTime;
        
        // Calculate bob offset
        const bobOffset = Math.sin(this.bobTimer) * this.bobAmplitude;
        
        // Apply vertical bob aligned with surface normal
        const upVector = this.player.surfaceNormal.clone();
        this.position.addScaledVector(upVector, bobOffset);
        
        // Get right vector for horizontal bob (perpendicular to normal and forward)
        const forward = new Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        const right = new Vector3().crossVectors(upVector, forward).normalize();
        
        // Apply slight horizontal bob
        this.position.addScaledVector(right, Math.cos(this.bobTimer + Math.PI) * this.bobAmplitude * 0.5);
    }
    
    updateFov(deltaTime) {
        // Set target FOV based on sprint state
        const sprintFovMultiplier = this.engine.config.sprintFovMultiplier || 1.1;
        this.targetFov = this.player.isSprinting ? 
            this.baseFov * sprintFovMultiplier : this.baseFov;
        
        // Smoothly interpolate current FOV to target
        if (Math.abs(this.currentFov - this.targetFov) > 0.1) {
            this.currentFov += (this.targetFov - this.currentFov) * 
                this.fovChangeSpeed * deltaTime;
            
            // Update camera FOV
            this.camera.fov = this.currentFov;
            this.camera.updateProjectionMatrix();
        }
    }
}