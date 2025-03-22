// src/physics/PhysicsWorld.js
import { Vector3 } from 'three';
import { PhysicsBody, StaticBody } from './PhysicsBody.js';

export class PhysicsWorld {
    constructor(engine) {
        this.engine = engine;
        this.bodies = [];
        this.staticBodies = [];
        this.gravity = new Vector3(0, engine.config.gravity, 0);
        
        this.accumulator = 0;
        this.fixedTimeStep = 1 / engine.config.physicsFPS;
        
        // For flat world ground detection
        this.groundThreshold = 0.15;
        this.groundRayDistance = 0.2;
        
        // Planet body for radial gravity
        this.planetBody = null;
        
        // Stability settings
        this.maxSubSteps = 3;
        
        // Debug
        this.debugDraw = false;
    }
    
    init() {
        console.log('Physics world initialized');
    }
    
    addBody(body) {
        if (!(body instanceof PhysicsBody)) {
            console.error('Trying to add a non-PhysicsBody object to the physics world');
            return null;
        }
        
        if (body.isStatic) {
            this.staticBodies.push(body);
        } else {
            this.bodies.push(body);
        }
        return body;
    }
    
    removeBody(body) {
        if (!body) return;
        
        if (body.isStatic) {
            const index = this.staticBodies.indexOf(body);
            if (index !== -1) {
                this.staticBodies.splice(index, 1);
            }
        } else {
            const index = this.bodies.indexOf(body);
            if (index !== -1) {
                this.bodies.splice(index, 1);
            }
        }
    }
    
    clear() {
        const playerBody = this.engine.player?.physicsBody;
        
        if (playerBody) {
            this.bodies = playerBody.isStatic ? [] : [playerBody];
            this.staticBodies = playerBody.isStatic ? [playerBody] : [];
        } else {
            this.bodies = [];
            this.staticBodies = [];
        }
    }
    
    update(deltaTime) {
        // Cap deltaTime to prevent spiral of death
        const cappedDelta = Math.min(deltaTime, 0.1);
        
        this.accumulator += cappedDelta;
        
        // Use fixed number of substeps for stability
        let substep = 0;
        while (this.accumulator >= this.fixedTimeStep && substep < this.maxSubSteps) {
            this.fixedUpdate(this.fixedTimeStep);
            this.accumulator -= this.fixedTimeStep;
            substep++;
        }
        
        // If we still have time left, do one final step
        if (substep >= this.maxSubSteps && this.accumulator > 0) {
            this.fixedUpdate(this.accumulator);
            this.accumulator = 0;
        }
    }
    
    setPlanetBody(planetBody) {
        this.planetBody = planetBody;
        console.log("Planet body set for radial gravity", planetBody);
    }
    
    fixedUpdate(timeStep) {
        // New execution order for better jump handling
        
        // 1. Safety check for extreme planet penetration
        if (this.planetBody) {
            for (const body of this.bodies) {
                // Get distance from planet center
                const distVector = new Vector3().subVectors(body.position, this.planetBody.center);
                const distance = distVector.length();
                
                // If severely inside planet, emergency correction
                const minSafeDistance = this.planetBody.radius * 0.9;
                if (distance < minSafeDistance) {
                    const safePos = this.planetBody.center.clone().add(
                        distVector.normalize().multiplyScalar(minSafeDistance + (body.radius || 0.5))
                    );
                    body.position.copy(safePos);
                    if (body.collider) {
                        body.collider.updatePosition(body.position);
                    }
                }
            }
        }
        
        // 2. Integrate velocity FIRST - this ensures jumps aren't cancelled
        for (const body of this.bodies) {
            body.integrateVelocity(timeStep);
        }
        
        // 3. Apply gravity and integrate forces
        for (const body of this.bodies) {
            if (body.usesGravity) {
                if (this.planetBody) {
                    this.planetBody.applyGravitationalForce(body);
                } else {
                    body.applyForce(this.gravity.clone().multiplyScalar(body.mass));
                }
            }
            
            body.integrateForces(timeStep);
        }
        
        // 4. Handle planet surface interactions
        if (this.planetBody) {
            for (const body of this.bodies) {
                this.planetBody.handlePlanetSurfaceInteraction(body, timeStep);
            }
        }
        
        // 5. Handle non-planet collisions
        this.detectCollisions();
        
        // 6. Check flat world bounds (if no planet)
        if (!this.planetBody) {
            for (const body of this.bodies) {
                this.checkWorldBounds(body);
            }
        }
    }
    
    detectCollisions() {
        // Skip planet collisions - handled separately with radial physics
        for (let i = 0; i < this.bodies.length; i++) {
            const bodyA = this.bodies[i];
            
            // Dynamic vs Dynamic
            for (let j = i + 1; j < this.bodies.length; j++) {
                const bodyB = this.bodies[j];
                if (this.checkCollision(bodyA, bodyB)) {
                    this.resolveCollision(bodyA, bodyB);
                }
            }
            
            // Dynamic vs Static
            for (const staticBody of this.staticBodies) {
                // Skip planets - handled with custom gravity
                if (staticBody.isPlanet) continue;
                
                if (this.checkCollision(bodyA, staticBody)) {
                    this.resolveCollision(bodyA, staticBody);
                }
            }
        }
    }
    
    checkCollision(bodyA, bodyB) {
        // Use collider intersection if available
        if (bodyA.collider && bodyB.collider) {
            return bodyA.collider.intersects(bodyB.collider);
        }
        
        // Fallback to simple sphere test
        const minDist = (bodyA.radius || 0) + (bodyB.radius || 0);
        if (minDist <= 0) return false;
        
        const dist = bodyA.position.distanceTo(bodyB.position);
        return dist < minDist;
    }
    
    resolveCollision(bodyA, bodyB) {
        // Try to get detailed collision info
        let collisionInfo = null;
        
        if (bodyA.checkCollision && typeof bodyA.checkCollision === 'function') {
            collisionInfo = bodyA.checkCollision(bodyB);
        }
        
        if (!collisionInfo && bodyB.checkCollision && typeof bodyB.checkCollision === 'function') {
            collisionInfo = bodyB.checkCollision(bodyA);
            // Invert normal if using B's collision info
            if (collisionInfo) {
                collisionInfo.normal.multiplyScalar(-1);
            }
        }
        
        if (collisionInfo) {
            const { normal, depth } = collisionInfo;
            const relativeVelocity = new Vector3().copy(bodyA.velocity || new Vector3());
            if (bodyB.velocity) {
                relativeVelocity.sub(bodyB.velocity);
            }
            
            const velAlongNormal = relativeVelocity.dot(normal);
            
            // Skip if objects are separating
            if (velAlongNormal > 0) return;
            
            const restitution = Math.min(
                bodyA.restitution || 0,
                bodyB.restitution || 0
            );
            
            let j = -(1 + restitution) * velAlongNormal;
            const invMassA = bodyA.invMass || 0;
            const invMassB = bodyB.invMass || 0;
            const invMassSum = invMassA + invMassB;
            
            if (invMassSum === 0) return;
            
            j /= invMassSum;
            const impulse = normal.clone().multiplyScalar(j);
            
            // Apply impulse to velocities
            if (bodyA.velocity && invMassA > 0) {
                bodyA.velocity.add(impulse.clone().multiplyScalar(invMassA));
            }
            if (bodyB.velocity && invMassB > 0) {
                bodyB.velocity.sub(impulse.clone().multiplyScalar(invMassB));
            }
            
            // Correct positions to prevent sinking
            if (depth > 0) {
                const gentleFactor = 0.1;
                const correction = normal.clone().multiplyScalar(depth * gentleFactor);
                
                if (invMassA > 0) {
                    bodyA.position.add(correction.clone().multiplyScalar(invMassA / invMassSum));
                    if (bodyA.collider) {
                        bodyA.collider.updatePosition(bodyA.position);
                    }
                }
                if (invMassB > 0) {
                    bodyB.position.sub(correction.clone().multiplyScalar(invMassB / invMassSum));
                    if (bodyB.collider) {
                        bodyB.collider.updatePosition(bodyB.position);
                    }
                }
            }
            
            return;
        }
        
        // Fallback sphere collision resolution
        const normal = bodyA.position.clone().sub(bodyB.position).normalize();
        const relativeVelocity = new Vector3().copy(bodyA.velocity || new Vector3());
        if (bodyB.velocity) {
            relativeVelocity.sub(bodyB.velocity);
        }
        
        const velAlongNormal = relativeVelocity.dot(normal);
        if (velAlongNormal > 0) return;
        
        const e = Math.min(
            bodyA.restitution || 0.3,
            bodyB.restitution || 0.3
        );
        
        const j = -(1 + e) * velAlongNormal;
        const invMassSum = (bodyA.invMass || 0) + (bodyB.invMass || 0);
        if (invMassSum === 0) return;
        
        const impulse = j / invMassSum;
        const impulseVec = normal.clone().multiplyScalar(impulse);
        
        if (bodyA.velocity && bodyA.invMass > 0) {
            bodyA.velocity.add(impulseVec.clone().multiplyScalar(bodyA.invMass));
        }
        if (bodyB.velocity && bodyB.invMass > 0) {
            bodyB.velocity.sub(impulseVec.clone().multiplyScalar(bodyB.invMass));
        }
        
        // Correct positions
        const minDist = (bodyA.radius || 0.5) + (bodyB.radius || 0.5);
        const dist = bodyA.position.distanceTo(bodyB.position);
        const correction = Math.max(minDist - dist, 0) * 0.3;
        
        if (correction > 0) {
            const correctionVec = normal.clone().multiplyScalar(correction);
            const corrA = correctionVec.clone().multiplyScalar(bodyA.invMass / invMassSum);
            const corrB = correctionVec.clone().multiplyScalar(bodyB.invMass / invMassSum);
            
            if (bodyA.invMass > 0) {
                bodyA.position.add(corrA);
                if (bodyA.collider) {
                    bodyA.collider.updatePosition(bodyA.position);
                }
            }
            if (bodyB.invMass > 0) {
                bodyB.position.sub(corrB);
                if (bodyB.collider) {
                    bodyB.collider.updatePosition(bodyB.position);
                }
            }
        }
    }
    
    checkWorldBounds(body) {
        // Only for flat world
        if (this.planetBody) return;
        
        if (body.position.y < this.groundThreshold) {
            // Keep slightly above ground
            if (body.position.y < 0) {
                body.position.y = 0.05;
            }
            
            // Mark as grounded and zero out y velocity
            if (body.velocity.y <= 0.1) {
                body.onGround = true;
                if (body.velocity.y < 0) {
                    body.velocity.y = 0;
                }
            }
        } else {
            body.onGround = false;
        }
    }
}