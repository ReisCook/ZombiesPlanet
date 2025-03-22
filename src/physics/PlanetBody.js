// src/physics/PlanetBody.js
import { Vector3 } from 'three';
import { StaticBody } from './PhysicsBody.js';

export class PlanetBody extends StaticBody {
    constructor(options = {}) {
        super(options);

        this.radius = options.radius || 20;
        this.center = options.position ? options.position.clone() : new Vector3(0, 0, 0);
        this.isPlanet = true;
        
        // Gravity strength
        this.gravityStrength = options.gravityStrength || 25;
        
        // Surface parameters
        this.surfaceOffset = 0.2;
        this.snapForce = 0.5;
        
        // Ground detection threshold
        this.groundThreshold = 0.3;
        
        // For numerical stability
        this.epsilon = 1e-6;
        
        // Minimum allowed distance to prevent clipping through planet
        this.minSafeDistance = this.radius * 0.9;
        
        // South pole region - where additional care is needed
        this.southPoleRegion = this.radius * 0.1; // 10% of radius near south pole
    }
    
    // We don't use this for planet collision
    checkCollision(other) {
        return null;
    }
    
    /**
     * Apply pure radial gravity force toward planet center
     */
    applyGravitationalForce(body) {
        if (!body.usesGravity) return;
        
        // Direction from body to planet center
        const toCenter = new Vector3().subVectors(this.center, body.position);
        const distanceSq = Math.max(toCenter.lengthSq(), this.epsilon);
        const distance = Math.sqrt(distanceSq);
        
        // Calculate unit direction vector
        const gravityDir = toCenter.clone().divideScalar(distance);
        
        // Calculate force based on mass and gravity strength
        const force = gravityDir.multiplyScalar(body.mass * this.gravityStrength);
        body.applyForce(force);
    }
    
    /**
     * Handle planet surface interaction with simplified approach
     */
    handlePlanetSurfaceInteraction(body, deltaTime) {
        if (!body.usesGravity) return;
        
        // Calculate vector from planet center to body
        const fromCenter = new Vector3().subVectors(body.position, this.center);
        const distance = Math.max(fromCenter.length(), this.epsilon);
        
        // SAFETY CHECK: If inside minimum safe distance, teleport out
        if (distance < this.minSafeDistance) {
            // Teleport to safe position
            const safePos = this.center.clone().add(
                fromCenter.normalize().multiplyScalar(this.minSafeDistance + (body.radius || 0.5))
            );
            body.position.copy(safePos);
            if (body.collider) {
                body.collider.updatePosition(body.position);
            }
            
            // Zero any inward velocity
            const radialDir = fromCenter.normalize();
            const normalVel = body.velocity.dot(radialDir);
            if (normalVel < 0) {
                body.velocity.sub(radialDir.clone().multiplyScalar(normalVel));
            }
        }
        
        // Calculate radial direction (normalized)
        const radialDir = fromCenter.clone().divideScalar(distance);
        
        // Update entity's surface normal for orientation
        if (body.entity && typeof body.entity.surfaceNormal !== 'undefined') {
            body.entity.surfaceNormal.copy(radialDir);
        }
        
        // Calculate ideal distance from surface
        const bodyRadius = body.radius || 0.5;
        const idealDistance = this.radius + this.surfaceOffset + bodyRadius;
        const distanceError = idealDistance - distance;
        
        // Determine if on ground based on distance from surface
        body.onGround = Math.abs(distanceError) < this.groundThreshold;
        
        // Check if in jump state
        const isJumping = body.entity && body.entity.isJumping;
        
        // If too close to surface, push outward
        if (distanceError > 0.01) {
            // Reduce force during jumps
            const pushFactor = isJumping ? 0.1 : this.snapForce;
            
            // Apply push force
            const pushForce = radialDir.clone().multiplyScalar(
                distanceError * pushFactor * body.mass
            );
            body.applyForce(pushForce);
        }
        
        // Handle ground state physics
        if (body.onGround) {
            // Get velocity component along surface normal
            const normalVel = body.velocity.dot(radialDir);
            
            // Cancel inward velocity component
            if (normalVel < 0) {
                body.velocity.sub(radialDir.clone().multiplyScalar(normalVel));
            }
            
            // Apply mild surface friction
            const frictionFactor = 0.98;
            body.velocity.multiplyScalar(frictionFactor);
            
            // Detect south pole proximity - slightly increase stability
            const southVector = new Vector3(0, -1, 0);
            const dotWithSouth = radialDir.dot(southVector);
            
            // If we're near the south pole (radial direction pointing up)
            if (dotWithSouth > 0.95) {
                // Apply additional stabilization
                body.velocity.multiplyScalar(0.95); // Stronger damping at south pole
            }
        }
    }
}