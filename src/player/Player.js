// src/player/Player.js
import { Vector3, Euler, Quaternion } from 'three';
import { Movement } from './Movement.js';
import { PhysicsBody } from '../physics/PhysicsBody.js';
import { WeaponManager } from '../weapons/WeaponManager.js';
import { InteractionSystem } from './InteractionSystem.js';

export class Player {
    constructor(engine) {
        this.engine = engine;
        
        // Player state
        this.position = new Vector3(0, 2, 0);
        this.velocity = new Vector3();
        this.viewRotation = new Euler(0, 0, 0, 'YXZ'); // YXZ for FPS
        this.moveInput = new Vector3(); // Desired movement direction
        this.isJumping = false;
        this.isSprinting = false;
        this.jumpCount = 0;
        this.maxJumps = engine.config.maxJumps || 2; // For double jump
        this.onGround = false;
        this.lastJumpTime = 0; // Track jump cooldown
        this.jumpRequested = false; // Flag for jump button press
        this.jumpBufferTime = 0; // Time when jump was requested
        this.jumpBufferWindow = 200; // Jump buffer window in ms
        this.coyoteTime = 150; // Coyote time in ms
        this.lastGroundedTime = 0; // Last time player was on ground
        
        // Jump state tracking for physics
        this.isJumping = false;
        this.jumpTimeStart = 0;
        this.jumpDuration = 350; // Jump state lasts for 350ms
        
        // Increased jump force for better feel
        this.jumpForce = 10.0;
        
        // Planet-oriented movement
        this.surfaceNormal = new Vector3(0, 1, 0);  // Default to world up
        this.orientationQuaternion = new Quaternion(); // Orientation for aligning to planet
        
        // View rotation tracking in radians - needed for proper planet traversal
        this.verticalAngle = 0; // Stores actual vertical rotation angle
        this.horizontalAngle = 0; // Stores actual horizontal rotation angle
        
        // Health system
        this.health = 100;
        this.maxHealth = 100;
        this.isDead = false;
        this.lastDamageTime = 0;
        this.invulnerabilityDuration = 500; // ms of invulnerability after damage
        
        // Mark as player entity for entity manager
        this.isPlayer = true;
        
        // Player physics body
        this.physicsBody = new PhysicsBody({
            position: this.position.clone(),
            mass: 75, // kg
            radius: 0.5, // Collision radius
            restitution: 0.0, // No bounce 
            friction: 0.1, // Low friction for smooth movement
            usesGravity: true,
            entity: this // Link to player entity
        });
        
        // Add physics body to world
        this.engine.physics.addBody(this.physicsBody);
        
        // Create movement controller
        this.movement = new Movement(this);
        
        // Create weapon manager
        this.weaponManager = new WeaponManager(this);
        
        // Create interaction system
        this.interactionSystem = new InteractionSystem(this);
        
        // Mouse sensitivity
        this.mouseSensitivity = this.engine.config.mouseSpeed || 0.002;
        
        // Safety check - track last frame's position for planet clipping
        this.lastPosition = this.position.clone();
        this.positionResetCount = 0;
        
        // Setup input bindings
        this.setupInputBindings();
        
        // Debug
        this.debugJump = false;
    }
    
    setupInputBindings() {
        const input = this.engine.input;
        
        // Mouse movement for camera
        input.onMouseMove((dx, dy) => {
            this.rotate(dx, dy);
        });
        
        // WASD movement - Responsive key handling
        input.onKeyDown('KeyW', () => { this.moveInput.z = -1; });
        input.onKeyUp('KeyW', () => { this.moveInput.z = 0; });
        
        input.onKeyDown('KeyS', () => { this.moveInput.z = 1; });
        input.onKeyUp('KeyS', () => { this.moveInput.z = 0; });
        
        input.onKeyDown('KeyA', () => { this.moveInput.x = -1; });
        input.onKeyUp('KeyA', () => { this.moveInput.x = 0; });
        
        input.onKeyDown('KeyD', () => { this.moveInput.x = 1; });
        input.onKeyUp('KeyD', () => { this.moveInput.x = 0; });
        
        // Jump - sets a flag and records time for buffer
        input.onKeyDown('Space', () => { 
            this.jumpRequested = true;
            this.jumpBufferTime = performance.now();
            if (this.debugJump) console.log("Jump requested!");
        });
        
        // Sprint
        input.onKeyDown('ShiftLeft', () => { this.isSprinting = true; });
        input.onKeyUp('ShiftLeft', () => { this.isSprinting = false; });
        
        // Toggle debug mode
        input.onKeyDown('F3', () => { 
            this.engine.debug.toggle();
            this.debugJump = !this.debugJump;
        });
    }
    
    rotate(dx, dy) {
        // Update rotation angles
        this.horizontalAngle -= dx * this.mouseSensitivity;
        this.verticalAngle -= dy * this.mouseSensitivity;
        
        // Clamp vertical rotation angle to prevent over-rotation
        // Use a slightly smaller range than ±PI/2 to prevent gimbal lock
        const maxVerticalAngle = Math.PI / 2 - 0.01;
        this.verticalAngle = Math.max(-maxVerticalAngle, Math.min(maxVerticalAngle, this.verticalAngle));
        
        // Update Euler rotation
        this.viewRotation.y = this.horizontalAngle;
        this.viewRotation.x = this.verticalAngle;
    }
    
    /**
     * Process jump input with buffer and coyote time
     */
    processJump() {
        const currentTime = performance.now();
        
        // Check if we're within coyote time (recently left ground)
        const inCoyoteTime = currentTime - this.lastGroundedTime < this.coyoteTime;
        const canFirstJump = this.onGround || inCoyoteTime;
        
        // Don't allow jump spam - small cooldown between jumps
        if (currentTime - this.lastJumpTime < 100) {
            return false;
        }
        
        if (this.debugJump) {
            console.log(`Jump: onGround=${this.onGround}, canJump=${canFirstJump}, jumpCount=${this.jumpCount}`);
        }
        
        if (canFirstJump && this.jumpCount === 0) {
            // Start jump state - this tells physics to ease up on surface clamping
            this.isJumping = true;
            this.jumpTimeStart = currentTime;
            
            // Initial jump - direct velocity modification for consistent feel
            if (this.engine.physics.planetBody) {
                // Jump along surface normal
                const jumpVec = this.surfaceNormal.clone().multiplyScalar(this.jumpForce);
                this.physicsBody.velocity.add(jumpVec);
                
                if (this.debugJump) {
                    console.log(`Jump executed! Force: ${jumpVec.length()}, Direction: ${jumpVec.x.toFixed(2)},${jumpVec.y.toFixed(2)},${jumpVec.z.toFixed(2)}`);
                }
            } else {
                // Flat world jump
                this.physicsBody.velocity.y = this.jumpForce;
            }
            
            this.jumpCount = 1;
            this.lastJumpTime = currentTime;
            
            // Apply jump boost via movement
            this.movement.applyJumpBoost();
            
            return true;
        } 
        else if (!canFirstJump && this.jumpCount < this.maxJumps) {
            // Double jump - reset jump state duration
            this.isJumping = true;
            this.jumpTimeStart = currentTime;
            
            if (this.engine.physics.planetBody) {
                // Slightly weaker second jump
                const jumpVec = this.surfaceNormal.clone().multiplyScalar(this.jumpForce * 0.9);
                this.physicsBody.velocity.add(jumpVec);
            } else {
                this.physicsBody.velocity.y = this.jumpForce * 0.9;
            }
            
            this.jumpCount++;
            this.lastJumpTime = currentTime;
            return true;
        }
        
        return false;
    }
    
    takeDamage(amount) {
        const currentTime = performance.now();
        
        // Check if player is invulnerable
        if (currentTime - this.lastDamageTime < this.invulnerabilityDuration) {
            return;
        }
        
        // Check if player is already dead
        if (this.isDead) return;
        
        // Apply damage
        this.health -= amount;
        this.lastDamageTime = currentTime;
        
        console.log(`Player took ${amount} damage. Health: ${this.health}/${this.maxHealth}`);
        
        // Update UI
        this.updateHealthUI();
        
        // Check if player died
        if (this.health <= 0) {
            this.health = 0;
            this.die();
        }
    }
    
    heal(amount) {
        if (this.isDead) return;
        
        this.health = Math.min(this.health + amount, this.maxHealth);
        console.log(`Player healed ${amount}. Health: ${this.health}/${this.maxHealth}`);
        
        // Update UI
        this.updateHealthUI();
    }
    
    updateHealthUI() {
        // You would implement UI updates here
    }
    
    die() {
        if (this.isDead) return;
        
        this.isDead = true;
        console.log("Player died!");
        
        // Disable movement
        this.moveInput.set(0, 0, 0);
        
        // Here you would trigger game over screen or respawn logic
        setTimeout(() => {
            this.respawn();
        }, 3000);
    }
    
    respawn() {
        // Reset player state
        this.health = this.maxHealth;
        this.isDead = false;
        
        // Move to spawn position
        this.position.set(0, 2, 0);
        this.physicsBody.position.copy(this.position);
        this.physicsBody.velocity.set(0, 0, 0);
        
        // Update UI
        this.updateHealthUI();
        
        console.log("Player respawned");
    }
    
    equipWeapon(weapon) {
        this.weaponManager.addWeapon(weapon);
    }
    
    update(deltaTime) {
        const currentTime = performance.now();
        
        // Don't update if dead
        if (this.isDead) return;
        
        // Save last position before updating
        this.lastPosition.copy(this.position);
        
        // Update jump state duration
        if (this.isJumping && currentTime - this.jumpTimeStart > this.jumpDuration) {
            this.isJumping = false;
        }
        
        // Sync from physics
        this.position.copy(this.physicsBody.position);
        this.velocity.copy(this.physicsBody.velocity);
        
        // Safety check for planet clipping - if player moves too far in one frame
        if (this.engine.physics.planetBody) {
            const planetCenter = this.engine.physics.planetBody.center;
            const minDist = this.engine.physics.planetBody.radius * 0.9;
            const curDistToCenter = this.position.distanceTo(planetCenter);
            
            if (curDistToCenter < minDist) {
                this.positionResetCount++;
                
                // Emergency reset if continuing to clip through planet
                if (this.positionResetCount > 3) {
                    console.log("Emergency reset - player clipping through planet");
                    
                    // Calculate safe position on planet surface
                    const toPlayer = this.position.clone().sub(planetCenter).normalize();
                    const safePos = planetCenter.clone().add(
                        toPlayer.multiplyScalar(this.engine.physics.planetBody.radius + 1.0)
                    );
                    
                    // Reset position and velocity
                    this.position.copy(safePos);
                    this.physicsBody.position.copy(safePos);
                    this.physicsBody.velocity.set(0, 0, 0);
                    
                    // Update collider
                    if (this.physicsBody.collider) {
                        this.physicsBody.collider.updatePosition(this.position);
                    }
                    
                    this.positionResetCount = 0;
                }
            } else {
                this.positionResetCount = 0;
            }
        }
        
        // Track ground state for coyote time
        const wasOnGround = this.onGround;
        this.onGround = this.physicsBody.onGround;
        
        if (this.debugJump && this.onGround !== wasOnGround) {
            console.log(`Ground state changed: ${wasOnGround} -> ${this.onGround}`);
        }
        
        // Just landed - reset jump count
        if (this.onGround && !wasOnGround) {
            this.jumpCount = 0;
        }
        // Just left ground - record time for coyote time
        else if (!this.onGround && wasOnGround) {
            this.lastGroundedTime = currentTime;
        }
        
        // Process jump request (with buffering)
        if (this.jumpRequested) {
            const withinBuffer = currentTime - this.jumpBufferTime < this.jumpBufferWindow;
            
            if (withinBuffer) {
                const jumped = this.processJump();
                if (jumped) {
                    this.jumpRequested = false;
                    // Prevent immediate re-grounding
                    this.lastGroundedTime = 0;
                }
            } else {
                // Buffer expired
                this.jumpRequested = false;
            }
        }
        
        // Update movement based on input
        this.movement.update(deltaTime);
        
        // Update weapon manager
        this.weaponManager.update(deltaTime);
        
        // Update interaction system
        this.interactionSystem.update();
        
        // Update orientation relative to planet
        if (this.engine.physics.planetBody) {
            this.updateCameraOrientation();
        }
    }
    
    // Update camera orientation based on surface normal
    updateCameraOrientation() {
        if (!this.surfaceNormal) return;
        
        // Create quaternion to align player with surface normal
        const worldUp = new Vector3(0, 1, 0);
        this.orientationQuaternion.setFromUnitVectors(worldUp, this.surfaceNormal);
    }
}