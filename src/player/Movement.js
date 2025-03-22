// src/player/Movement.js
import { Vector3, Quaternion, Euler } from 'three';

export class Movement {
    constructor(player) {
        this.player = player;
        this.engine = player.engine;
        
        // Movement parameters
        this.walkSpeed = 6.0;
        this.runSpeed = 10.0;
        this.maxSpeed = 12.0;
        
        // Acceleration
        this.groundAcceleration = 150.0;
        this.airAcceleration = 20.0;
        
        // Deceleration
        this.stopAcceleration = 200.0;
        this.groundFriction = 8.0;
        this.airFriction = 0.1;
        
        // Directional change handling
        this.momentumRetention = 0.5;
        this.dirChangeBoostMultiplier = 3.0;
        
        // Jump parameters
        this.jumpBoostForward = 0.2;
        
        // Air control
        this.airControl = 0.9;
        
        // Movement vectors
        this.moveDirection = new Vector3();
        this.targetVelocity = new Vector3();
        this.lastMoveInput = new Vector3();
        this.lastDirection = new Vector3();
        this.lastSpeed = 0;
        
        // Direction change detection
        this.directionChangeTime = 0;
        this.hasChangedDirection = false;
        this.directionChangeThreshold = 0.85;
    }
    
    update(deltaTime) {
        // Get movement input
        const moveInput = this.player.moveInput.clone();
        const hasInput = moveInput.lengthSq() > 0;
        
        if (hasInput) {
            // Normalize input if needed
            if (moveInput.lengthSq() > 1) {
                moveInput.normalize();
            }
            
            // Calculate movement direction in world space
            this.calculateMoveDirection(moveInput);
            
            // Check for significant direction change
            this.detectDirectionChange();
            
            // Calculate target velocity with speed
            const speed = this.player.isSprinting ? this.runSpeed : this.walkSpeed;
            this.targetVelocity.copy(this.moveDirection).multiplyScalar(speed);
            
            // Apply acceleration with momentum preservation
            this.applyAccelerationWithMomentum(deltaTime);
        } else {
            // Apply stronger deceleration when no input
            this.applyStopForce(deltaTime);
        }
        
        // Save last values for next frame
        this.lastMoveInput.copy(moveInput);
        if (this.moveDirection.lengthSq() > 0) {
            this.lastDirection.copy(this.moveDirection);
        }
        this.lastSpeed = this.player.physicsBody.velocity.length();
    }
    
    calculateMoveDirection(moveInput) {
        if (this.engine.physics.planetBody) {
            // ***CRITICAL FIX: USE CAMERA DIRECTION DIRECTLY***
            // Get camera for direction reference
            const camera = this.engine.camera.camera;
            
            // Get forward and right vectors directly from camera
            // This ensures WASD always aligns with what the player is seeing
            const cameraForward = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
            const cameraRight = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
            
            // Get up vector from surface normal
            const up = this.player.surfaceNormal.clone().normalize();
            
            // Project camera vectors to surface tangent plane
            const forward = this.projectVectorToPlane(cameraForward, up);
            const right = this.projectVectorToPlane(cameraRight, up);
            
            // Ensure vectors are normalized
            if (forward.lengthSq() > 0.001) forward.normalize();
            if (right.lengthSq() > 0.001) right.normalize();
            
            // Calculate movement direction
            this.moveDirection.set(0, 0, 0);
            this.moveDirection.addScaledVector(forward, -moveInput.z); // W/S
            this.moveDirection.addScaledVector(right, moveInput.x);    // A/D
            
            // Normalize if has length
            if (this.moveDirection.lengthSq() > 0.001) {
                this.moveDirection.normalize();
            }
        } else {
            // Flat world movement
            const rotation = new Quaternion().setFromEuler(
                new Euler(0, this.player.viewRotation.y, 0)
            );
            
            const forward = new Vector3(0, 0, -1).applyQuaternion(rotation);
            const right = new Vector3(1, 0, 0).applyQuaternion(rotation);
            
            // Zero out Y component for flat world
            forward.y = 0;
            right.y = 0;
            
            if (forward.lengthSq() > 0) forward.normalize();
            if (right.lengthSq() > 0) right.normalize();
            
            this.moveDirection.set(0, 0, 0);
            this.moveDirection.addScaledVector(forward, -moveInput.z);
            this.moveDirection.addScaledVector(right, moveInput.x);
            
            if (this.moveDirection.lengthSq() > 0) {
                this.moveDirection.normalize();
            }
        }
    }
    
    // Helper function to project a vector onto a plane defined by its normal
    projectVectorToPlane(vector, planeNormal) {
        // v_projected = v - (v·n)n
        const normalComponent = vector.dot(planeNormal);
        return vector.clone().sub(planeNormal.clone().multiplyScalar(normalComponent));
    }
    
    detectDirectionChange() {
        // Skip if we don't have a previous direction
        if (this.lastDirection.lengthSq() === 0) {
            this.hasChangedDirection = false;
            return;
        }
        
        // Dot product to find angle between directions
        const dotProduct = this.lastDirection.dot(this.moveDirection);
        
        // If directions differ significantly
        if (dotProduct < this.directionChangeThreshold) {
            this.hasChangedDirection = true;
            this.directionChangeTime = performance.now();
        } else {
            // Direction change expires after 100ms
            this.hasChangedDirection = this.hasChangedDirection && 
                (performance.now() - this.directionChangeTime < 100);
        }
    }
    
    applyAccelerationWithMomentum(deltaTime) {
        let currentVelocity;
        
        if (this.engine.physics.planetBody) {
            // Extract tangential velocity component (no radial component)
            currentVelocity = this.player.physicsBody.velocity.clone();
            const normal = this.player.surfaceNormal;
            
            // Make sure normal is valid
            if (normal.lengthSq() > 0.001) {
                const normalComponent = currentVelocity.dot(normal);
                currentVelocity.sub(normal.clone().multiplyScalar(normalComponent));
            }
        } else {
            // For flat world, just use horizontal velocity
            currentVelocity = new Vector3(
                this.player.physicsBody.velocity.x,
                0,
                this.player.physicsBody.velocity.z
            );
        }
        
        // Current speed in tangent plane
        const currentSpeed = currentVelocity.length();
        
        // Create new velocity vector
        let newVelocity = new Vector3();
        
        if (this.hasChangedDirection && currentSpeed > 2.0) {
            // Preserve some momentum when changing direction
            newVelocity.copy(currentVelocity).multiplyScalar(this.momentumRetention);
            
            // Add target velocity contribution
            const targetContributionFactor = 1.0 - this.momentumRetention;
            newVelocity.addScaledVector(this.targetVelocity, targetContributionFactor);
        } else {
            // Calculate acceleration
            let accel = this.player.onGround ? this.groundAcceleration : this.airAcceleration;
            
            // Boost acceleration for initial movement and direction changes
            if (currentSpeed < 2.0 || this.hasChangedDirection) {
                accel *= this.dirChangeBoostMultiplier;
            }
            
            // Apply air control reduction
            if (!this.player.onGround) {
                accel *= this.airControl;
            }
            
            // Calculate velocity delta
            const velocityDelta = new Vector3().subVectors(this.targetVelocity, currentVelocity);
            
            // Apply acceleration with deltaTime
            velocityDelta.multiplyScalar(Math.min(accel * deltaTime, 1.0));
            
            // Add to current velocity
            newVelocity.addVectors(currentVelocity, velocityDelta);
        }
        
        // Limit maximum speed
        const newSpeed = newVelocity.length();
        if (newSpeed > this.maxSpeed) {
            newVelocity.multiplyScalar(this.maxSpeed / newSpeed);
        }
        
        if (this.engine.physics.planetBody) {
            // Preserve normal velocity component (perpendicular to surface)
            const originalVelocity = this.player.physicsBody.velocity.clone();
            const normal = this.player.surfaceNormal;
            
            // Only combine with normal component if normal is valid
            if (normal.lengthSq() > 0.001) {
                const normalComponent = originalVelocity.dot(normal);
                const normalVelocity = normal.clone().multiplyScalar(normalComponent);
                
                // Combine tangential and normal components
                this.player.physicsBody.velocity.copy(newVelocity).add(normalVelocity);
            } else {
                // Just use the new velocity if normal is invalid
                this.player.physicsBody.velocity.copy(newVelocity);
            }
        } else {
            // For flat world, just apply to X and Z
            this.player.physicsBody.velocity.x = newVelocity.x;
            this.player.physicsBody.velocity.z = newVelocity.z;
        }
        
        // Apply forward boost when jumping
        if (this.player.isJumping && this.player.jumpCount === 1) {
            const forwardBoost = this.moveDirection.clone()
                .multiplyScalar(this.jumpBoostForward * this.walkSpeed);
            
            this.player.physicsBody.velocity.add(forwardBoost);
            this.player.isJumping = false;
        }
    }
    
    applyStopForce(deltaTime) {
        let velocity = this.player.physicsBody.velocity;
        let horizontalVelocity;
        
        if (this.engine.physics.planetBody) {
            // Get tangential component for planet
            const normal = this.player.surfaceNormal;
            
            // Make sure normal is valid
            if (normal.lengthSq() > 0.001) {
                const normalComponent = velocity.dot(normal);
                horizontalVelocity = velocity.clone().sub(
                    normal.clone().multiplyScalar(normalComponent)
                );
            } else {
                // Just use full velocity if normal is invalid
                horizontalVelocity = velocity.clone();
            }
        } else {
            // Horizontal velocity for flat world
            horizontalVelocity = new Vector3(velocity.x, 0, velocity.z);
        }
        
        const speed = horizontalVelocity.length();
        
        // If barely moving, just zero out tangential velocity
        if (speed < 0.1) {
            if (this.engine.physics.planetBody) {
                // Preserve normal component
                const normal = this.player.surfaceNormal;
                
                // Make sure normal is valid
                if (normal.lengthSq() > 0.001) {
                    const normalComponent = velocity.dot(normal);
                    this.player.physicsBody.velocity.copy(
                        normal.clone().multiplyScalar(normalComponent)
                    );
                } else {
                    // Just zero out velocity if normal is invalid
                    this.player.physicsBody.velocity.set(0, 0, 0);
                }
            } else {
                // Zero X and Z for flat world
                velocity.x = 0;
                velocity.z = 0;
            }
            return;
        }
        
        // Calculate deceleration
        const stopAccel = this.player.onGround ? 
            this.stopAcceleration : this.stopAcceleration * 0.2;
        
        const deceleration = Math.min(speed, stopAccel * deltaTime);
        
        // Calculate direction to apply deceleration
        const direction = horizontalVelocity.clone().normalize();
        
        if (this.engine.physics.planetBody) {
            // For planet movement
            const normal = this.player.surfaceNormal;
            
            // Make sure normal is valid
            if (normal.lengthSq() > 0.001) {
                const normalComponent = velocity.dot(normal);
                const normalVelocity = normal.clone().multiplyScalar(normalComponent);
                
                // Apply deceleration to tangential component
                horizontalVelocity.sub(direction.multiplyScalar(deceleration));
                
                // Recombine with normal component
                this.player.physicsBody.velocity.copy(horizontalVelocity).add(normalVelocity);
            } else {
                // Just apply deceleration directly if normal is invalid
                horizontalVelocity.sub(direction.multiplyScalar(deceleration));
                this.player.physicsBody.velocity.copy(horizontalVelocity);
            }
        } else {
            // For flat world
            velocity.x -= direction.x * deceleration;
            velocity.z -= direction.z * deceleration;
        }
    }
    
    // Allow jump to add forward momentum
    applyJumpBoost() {
        if (this.moveDirection.lengthSq() > 0 && this.player.onGround) {
            this.player.isJumping = true;
        }
    }
}