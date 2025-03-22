// src/entities/Zombie.js - Updated for planet-based movement
import { 
    Vector3, AnimationMixer, Clock, Euler, Quaternion,
    MeshStandardMaterial, Color, BoxGeometry, Mesh, Group,
    SkeletonHelper, AnimationClip, Matrix4
} from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { PhysicsBody } from '../physics/PhysicsBody.js';

// Import Three.js constants for animation
const LoopOnce = 2200; // THREE.LoopOnce
const LoopRepeat = 2201; // THREE.LoopRepeat

export class Zombie {
    constructor(engine, position = new Vector3(0, 0, 0)) {
        // Core properties
        this.engine = engine;
        this.type = 'zombie';
        this.id = null; // Will be assigned by EntityManager
        this.position = position.clone();
        this.rotation = new Euler(0, 0, 0);
        this.quaternion = new Quaternion();
        this.enabled = true;
        this.isAlive = true;
        
        // Planet-specific orientation
        this.surfaceNormal = new Vector3(0, 1, 0);
        this.surfaceOrientationMatrix = new Matrix4();
        
        // Physics body with planet support
        this.physicsBody = new PhysicsBody({
            position: this.position.clone(),
            mass: 70,
            radius: 0.5,
            restitution: 0.2,
            friction: 0.5
        });
        
        // State management for chasing
        this.state = 'idle';
        this.lastStateChangeTime = 0;
        this.timeInCurrentState = 0;
        this.timeSinceSpawn = 0;
        
        // Movement properties
        this.speed = { walk: 2.0, run: 4.0 };
        this.currentSpeed = 0;
        this.moveDirection = new Vector3();
        this.turnSpeed = 4.0;
        
        // Player tracking
        this.canSeePlayer = false;
        this.detectionRange = 15; // How far away zombie can detect player
        this.updatePerceptionTime = 0;
        this.perceptionUpdateRate = 0.2;
        this.lastKnownPlayerPosition = null;
        
        // Combat properties
        this.health = 100;
        this.maxHealth = 100;
        this.attackRange = 1.8;
        this.attackCooldown = 1.2;
        this.lastAttackTime = 0;
        
        // Animation properties
        this.object = null;
        this.mixer = null;
        this.animations = {};
        this.currentAnimation = null;
        this.animationSpeed = 1.0;
        this.skeletonHelper = null;
        
        // Bone references
        this.bones = {};
        
        // Debug properties
        this.debugMode = false;
        
        console.log("Zombie created at", position.x, position.y, position.z);
    }
    
    async init(engine) {
        // Store engine reference if passed
        if (engine) this.engine = engine;
        
        console.log("Zombie: Initializing...");
        
        // Add physics body to world
        if (this.engine.physics) {
            this.engine.physics.addBody(this.physicsBody);
        }
        
        // Load zombie model and animations
        await this.loadModel();
        
        // Initial state
        this.changeState('idle');
        
        return this;
    }
    
    async loadModel() {
        try {
            // Get zombie model from asset manager
            const zombieModel = this.engine.assetManager.getModel('zombie');
            
            if (!zombieModel) {
                console.error("Zombie model not found!");
                this.createDebugMesh();
                return;
            }
            
            // Clone model with skeleton
            this.object = skeletonClone(zombieModel);
            
            // Set scale and position
            this.object.scale.set(0.01, 0.01, 0.01);
            this.object.position.copy(this.position);
            
            // Setup animation mixer
            this.mixer = new AnimationMixer(this.object);
            
            // Map animations from asset manager
            this.mapAnimations();
            
            // Find and cache bone references
            this.findBones();
            
            // Create skeleton helper if in debug mode
            if (this.debugMode) {
                this.skeletonHelper = new SkeletonHelper(this.object);
                this.engine.renderer.scene.add(this.skeletonHelper);
            }
            
            // Add to scene
            this.engine.renderer.scene.add(this.object);
            
        } catch (error) {
            console.error("Failed to load zombie model:", error);
            this.createDebugMesh();
        }
    }
    
    mapAnimations() {
        // Animation mapping
        const animationMap = {
            'idle': 'idle',
            'walk': 'walk',
            'run': 'run',
            'attack': 'attack',
            'death': 'death',
            'scream': 'scream'
        };
        
        // Get animations from asset manager
        for (const [animId, animName] of Object.entries(animationMap)) {
            const anim = this.engine.assetManager.getAnimation(animId);
            if (anim) {
                this.animations[animName] = anim;
            }
        }
    }
    
    findBones() {
        this.bones = {};
        
        // Find important bones by name
        this.object.traverse(node => {
            if (node.isBone || node.type === 'Bone') {
                const name = node.name.toLowerCase();
                
                // Store all bones by name
                this.bones[node.name] = node;
                
                // Also categorize key bones
                if (name.includes('head')) {
                    this.bones.head = node;
                } else if (name.includes('spine')) {
                    this.bones.spine = node;
                } else if (name.includes('left') && name.includes('arm')) {
                    this.bones.leftArm = node;
                } else if (name.includes('right') && name.includes('arm')) {
                    this.bones.rightArm = node;
                } else if (name.includes('left') && name.includes('leg')) {
                    this.bones.leftLeg = node;
                } else if (name.includes('right') && name.includes('leg')) {
                    this.bones.rightLeg = node;
                }
            }
        });
    }
    
    createDebugMesh() {
        // Create simple colored mesh as fallback
        const bodyGeo = new BoxGeometry(0.5, 1.0, 0.3);
        const headGeo = new BoxGeometry(0.3, 0.3, 0.3);
        const limbGeo = new BoxGeometry(0.15, 0.5, 0.15);
        
        const material = new MeshStandardMaterial({ color: new Color(0x00aa00) });
        
        this.object = new Group();
        this.object.position.copy(this.position);
        
        // Body parts
        const body = new Mesh(bodyGeo, material);
        body.position.y = 0.5;
        this.object.add(body);
        
        const head = new Mesh(headGeo, material);
        head.position.y = 1.15;
        this.object.add(head);
        
        const leftArm = new Mesh(limbGeo, material);
        leftArm.position.set(-0.325, 0.5, 0);
        this.object.add(leftArm);
        
        const rightArm = new Mesh(limbGeo, material);
        rightArm.position.set(0.325, 0.5, 0);
        this.object.add(rightArm);
        
        const leftLeg = new Mesh(limbGeo, material);
        leftLeg.position.set(-0.2, -0.25, 0);
        this.object.add(leftLeg);
        
        const rightLeg = new Mesh(limbGeo, material);
        rightLeg.position.set(0.2, -0.25, 0);
        this.object.add(rightLeg);
        
        // Add to scene and create dummy mixer
        this.engine.renderer.scene.add(this.object);
        this.mixer = new AnimationMixer(this.object);
    }
    
    playAnimation(name, loop = true, speedFactor = 1.0) {
        // Skip if no mixer
        if (!this.mixer) return;
        
        // Process animation name
        let actualName = name;
        
        // Handle missing animations with fallbacks
        if (name === 'idle' && !this.animations['idle']) {
            actualName = 'walk';
            speedFactor = 0.25;
        }
        else if (name === 'chase' && !this.animations['chase']) {
            actualName = 'walk';
            speedFactor = 1.2;
        }
        else if (name === 'run' && !this.animations['run']) {
            actualName = 'walk';
            speedFactor = 1.5;
        }
        
        let clip = this.animations[actualName];
        
        // Try walk as fallback
        if (!clip) {
            actualName = 'walk';
            clip = this.animations['walk'];
            
            if (!clip) return;
        }
        
        // Stop current animation
        if (this.currentAnimation) {
            this.currentAnimation.fadeOut(0.2);
        }
        
        // Create and play new animation
        const action = this.mixer.clipAction(clip);
        action.reset();
        action.loop = loop ? LoopRepeat : LoopOnce;
        action.clampWhenFinished = !loop;
        action.timeScale = speedFactor;
        action.fadeIn(0.2);
        action.play();
        
        this.currentAnimation = action;
    }
    
    update(deltaTime) {
        if (!this.enabled || !this.isAlive) return;
        
        // Update timers
        this.timeSinceSpawn += deltaTime;
        this.timeInCurrentState += deltaTime;
        
        // Update planet-based orientation
        this.updateOrientationToPlanet();
        
        // Update animations
        if (this.mixer) {
            this.mixer.update(deltaTime * this.animationSpeed);
        }
        
        // Update perception (can see player, etc)
        this.updatePerception(deltaTime);
        
        // State machine processing
        this.processStateMachine(deltaTime);
        
        // Update position from physics
        if (this.physicsBody) {
            this.position.copy(this.physicsBody.position);
        }
        
        // Update visual position and orientation
        if (this.object) {
            this.object.position.copy(this.position);
            
            // Apply orientation quaternion for planet surface alignment
            // and rotation for facing direction
            
            // First get surface-aligned quaternion
            const surfaceQuat = this.getSurfaceAlignmentQuaternion();
            
            // Create Y-axis rotation quaternion for facing direction
            const facingQuat = new Quaternion().setFromEuler(
                new Euler(0, this.rotation.y, 0)
            );
            
            // Combine the two quaternions: first align to surface, then apply facing rotation
            this.object.quaternion.copy(surfaceQuat).multiply(facingQuat);
            
            // Update skeleton helper if exists
            if (this.skeletonHelper) {
                this.skeletonHelper.update();
            }
        }
    }
    
    // Update orientation based on planet surface
    updateOrientationToPlanet() {
        if (!this.engine.physics.planetBody) return;
        
        // Get planet data
        const planetCenter = this.engine.physics.planetBody.center;
        
        // Calculate up vector from planet center to zombie position
        this.surfaceNormal.copy(this.position).sub(planetCenter).normalize();
        
        // Store this on physics body for proper physics calculations
        if (this.physicsBody) {
            this.physicsBody.surfaceNormal = this.surfaceNormal.clone();
        }
    }
    
    // Get quaternion to align with planet surface
    getSurfaceAlignmentQuaternion() {
        // Default up vector (world space)
        const worldUp = new Vector3(0, 1, 0);
        
        // Create quaternion to rotate from world up to surface normal
        return new Quaternion().setFromUnitVectors(worldUp, this.surfaceNormal);
    }
    
    processStateMachine(deltaTime) {
        // State transitions - can see player should trigger chase
        if (this.state === 'idle' && this.canSeePlayer) {
            this.changeState('chase');
        }
        
        // Process current state
        switch (this.state) {
            case 'idle':
                this.processIdleState(deltaTime);
                break;
                
            case 'chase':
                this.processChaseState(deltaTime);
                break;
                
            case 'attack':
                this.processAttackState(deltaTime);
                break;
                
            case 'death':
                // No movement in death state
                break;
        }
    }
    
    processIdleState(deltaTime) {
        // Simple idle behavior - slight movement/looking around
        if (Math.random() < 0.01) {
            // Random small rotation
            this.rotation.y += (Math.random() - 0.5) * 0.5;
        }
        
        // Play idle animation
        if (!this.currentAnimation || this.currentAnimation._clip.name !== 'idle') {
            this.playAnimation('idle');
        }
    }
    
    processChaseState(deltaTime) {
        // Get player position
        const player = this.engine.player;
        if (!player) return;
        
        // Store last known position when visible
        if (this.canSeePlayer) {
            this.lastKnownPlayerPosition = player.position.clone();
        }
        
        // Move toward player
        if (this.lastKnownPlayerPosition) {
            // Check if close enough to attack
            const distanceToPlayer = this.position.distanceTo(player.position);
            
            if (distanceToPlayer <= this.attackRange) {
                this.changeState('attack');
                return;
            }
            
            // Calculate move direction along planet surface
            this.calculatePlanetSurfaceMovement(player.position);
            
            // Play walk/run animation
            if (!this.currentAnimation || 
                (this.currentAnimation._clip.name !== 'walk' && 
                 this.currentAnimation._clip.name !== 'run')) {
                this.playAnimation('walk', true, 1.2);
            }
        }
        
        // If lost track of player for too long, go back to idle
        if (!this.canSeePlayer && this.timeInCurrentState > 8.0) {
            this.changeState('idle');
        }
    }
    
    // Calculate movement along the planet surface toward a target
    calculatePlanetSurfaceMovement(targetPosition) {
        // Calculate direction to target in world space
        const directionToTarget = new Vector3().subVectors(targetPosition, this.position).normalize();
        
        // Calculate tangent plane to the planet surface at zombie's position
        // Project the direction to target onto the tangent plane
        // by removing the component along the surface normal
        const normalComponent = directionToTarget.dot(this.surfaceNormal);
        const tangentDirection = new Vector3().copy(directionToTarget)
            .sub(this.surfaceNormal.clone().multiplyScalar(normalComponent))
            .normalize();
        
        // Calculate rotation to face the target along the surface
        // Create basis vectors for the tangent plane
        const tangentRight = new Vector3().crossVectors(this.surfaceNormal, new Vector3(0, 0, 1)).normalize();
        if (tangentRight.lengthSq() < 0.1) {
            // If right is too small (normal aligned with Z), use X instead
            tangentRight.crossVectors(this.surfaceNormal, new Vector3(1, 0, 0)).normalize();
        }
        
        const tangentForward = new Vector3().crossVectors(tangentRight, this.surfaceNormal).normalize();
        
        // Calculate angle to target in the tangent plane
        const angleToTarget = Math.atan2(
            tangentDirection.dot(tangentRight),
            tangentDirection.dot(tangentForward)
        );
        
        // Set rotation to face target
        this.rotation.y = angleToTarget;
        
        // Set velocity along the tangent direction
        const chaseSpeed = 3.0;
        if (this.physicsBody) {
            this.physicsBody.velocity.copy(tangentDirection.multiplyScalar(chaseSpeed));
            
            // Ensure velocity is tangent to surface - remove any normal component
            const normalVelocityComponent = this.physicsBody.velocity.dot(this.surfaceNormal);
            this.physicsBody.velocity.sub(
                this.surfaceNormal.clone().multiplyScalar(normalVelocityComponent)
            );
        }
    }
    
    processAttackState(deltaTime) {
        const player = this.engine.player;
        if (!player) return;
        
        // Check distance to player
        const distanceToPlayer = this.position.distanceTo(player.position);
        
        // If player moved away, go back to chase
        if (distanceToPlayer > this.attackRange * 1.2) {
            this.changeState('chase');
            return;
        }
        
        // Face the player - modified for planet surface
        this.lookAtOnPlanet(player.position);
        
        // Execute attack with cooldown
        if (this.timeSinceSpawn - this.lastAttackTime > this.attackCooldown) {
            // Play attack animation
            this.playAnimation('attack', false);
            
            // Deal damage at appropriate time in animation (after 0.5s)
            setTimeout(() => {
                if (this.state === 'attack' && player.takeDamage && 
                    this.position.distanceTo(player.position) <= this.attackRange) {
                    player.takeDamage(20, this);
                }
            }, 500);
            
            this.lastAttackTime = this.timeSinceSpawn;
            
            // Return to chase after attack completes
            setTimeout(() => {
                if (this.state === 'attack') {
                    this.changeState('chase');
                }
            }, 1200);
        }
    }
    
    // Check if zombie can see player - updated for planet curvature
    updatePerception(deltaTime) {
        // Only update perception periodically
        this.updatePerceptionTime -= deltaTime;
        if (this.updatePerceptionTime <= 0) {
            this.updatePerceptionTime = this.perceptionUpdateRate;
            
            // Reset perception
            const previouslyCouldSeePlayer = this.canSeePlayer;
            this.canSeePlayer = false;
            
            // Get player
            const player = this.engine.player;
            if (!player) return;
            
            // Check distance to player
            const distanceToPlayer = this.position.distanceTo(player.position);
            
            // If within detection range, can see player
            if (distanceToPlayer <= this.detectionRange) {
                // Line of sight check considering planet curvature
                // If dot product of directions to player and surface normal is positive,
                // player is above horizon and visible
                const dirToPlayer = new Vector3().subVectors(player.position, this.position).normalize();
                const normalDot = dirToPlayer.dot(this.surfaceNormal);
                
                // Check angle between player direction and surface tangent
                // If angle is close to 90 degrees, player is over the horizon
                const horizontalAngle = Math.acos(Math.abs(normalDot));
                
                // If angle is less than 80 degrees, player is visible
                // (allowing some visibility beyond perfect tangent)
                if (horizontalAngle < Math.PI/2.2) {
                    this.canSeePlayer = true;
                    
                    // If just spotted player, react
                    if (!previouslyCouldSeePlayer && this.state === 'idle') {
                        this.onPlayerSpotted();
                    }
                }
            }
        }
    }
    
    onPlayerSpotted() {
        // React to seeing player - change state to chase
        this.changeState('chase');
    }
    
    // Look at a target position - updated for planet orientation
    lookAtOnPlanet(targetPos) {
        // Calculate direction to target in world space
        const directionToTarget = new Vector3().subVectors(targetPos, this.position).normalize();
        
        // Project direction onto tangent plane to get flat direction
        const normalComponent = directionToTarget.dot(this.surfaceNormal);
        const tangentDirection = new Vector3().copy(directionToTarget)
            .sub(this.surfaceNormal.clone().multiplyScalar(normalComponent))
            .normalize();
        
        // Create basis vectors for the tangent plane
        const tangentRight = new Vector3().crossVectors(this.surfaceNormal, new Vector3(0, 0, 1)).normalize();
        if (tangentRight.lengthSq() < 0.1) {
            // If right is too small (normal aligned with Z), use X instead
            tangentRight.crossVectors(this.surfaceNormal, new Vector3(1, 0, 0)).normalize();
        }
        
        const tangentForward = new Vector3().crossVectors(tangentRight, this.surfaceNormal).normalize();
        
        // Calculate angle to target in the tangent plane
        const angleToTarget = Math.atan2(
            tangentDirection.dot(tangentRight),
            tangentDirection.dot(tangentForward)
        );
        
        // Set rotation to face target
        this.rotation.y = angleToTarget;
    }
    
    // Change state with animation transitions
    changeState(newState) {
        if (newState === this.state) return;
        
        const oldState = this.state;
        this.state = newState;
        this.timeInCurrentState = 0;
        
        console.log(`Zombie ${this.id} state: ${oldState} -> ${newState}`);
        
        // State-specific setup
        switch (newState) {
            case 'idle':
                this.playAnimation('idle', true);
                if (this.physicsBody) {
                    // Stop horizontal movement but maintain gravity
                    const verticalVelocity = this.physicsBody.velocity.dot(this.surfaceNormal);
                    this.physicsBody.velocity.copy(this.surfaceNormal.clone().multiplyScalar(verticalVelocity));
                }
                break;
                
            case 'chase':
                this.playAnimation('walk', true, 1.2);
                break;
                
            case 'attack':
                this.playAnimation('attack', false);
                if (this.physicsBody) {
                    // Stop horizontal movement but maintain gravity
                    const verticalVelocity = this.physicsBody.velocity.dot(this.surfaceNormal);
                    this.physicsBody.velocity.copy(this.surfaceNormal.clone().multiplyScalar(verticalVelocity));
                }
                break;
                
            case 'death':
                this.playAnimation('death', false);
                this.isAlive = false;
                if (this.physicsBody) {
                    this.physicsBody.velocity.set(0, 0, 0);
                }
                break;
        }
    }
    
    // Handle taking damage
    takeDamage(amount) {
        this.health -= amount;
        
        // Play hit reaction
        if (this.health <= 0 && this.isAlive) {
            this.changeState('death');
        }
    }
    
    // Required method for EntityManager
    destroy() {
        // Remove from scene
        if (this.object) {
            this.engine.renderer.scene.remove(this.object);
        }
        
        if (this.skeletonHelper) {
            this.engine.renderer.scene.remove(this.skeletonHelper);
        }
        
        // Remove physics body
        if (this.physicsBody && this.engine.physics) {
            this.engine.physics.removeBody(this.physicsBody);
        }
        
        // Clear animation data
        if (this.mixer) {
            this.mixer.stopAllAction();
        }
        
        this.animations = {};
        this.currentAnimation = null;
        this.enabled = false;
    }
    
    // For compatibility with EnemyManager
    canSensePlayer() {
        return this.canSeePlayer;
    }
    
    canAttackTarget() {
        if (!this.engine.player) return false;
        
        const distanceToPlayer = this.position.distanceTo(this.engine.player.position);
        return distanceToPlayer <= this.attackRange;
    }
}