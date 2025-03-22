// src/entities/EnemyManager.js
import { Vector3 } from 'three';
import { Zombie } from './Zombie.js';

export class EnemyManager {
    constructor(engine) {
        this.engine = engine;
        this.enemies = [];
        this.maxEnemies = 5; // Maximum number of zombies at once
        this.spawnCooldown = 5; // Seconds between spawns
        this.lastSpawnTime = 0;
        this.spawnPoints = []; // Will be populated from map data
        this.enabled = true;
    }
    
    init() {
        console.log("Enemy manager initialized");
    }
    
    async loadEnemyAssets() {
        try {
            // Dynamically import the ZombieAssetLoader
            const { ZombieAssetLoader } = await import('../assets/ZombieAssetLoader.js');
            const loader = new ZombieAssetLoader(this.engine.assetManager);
            
            // Load all zombie assets
            const success = await loader.loadZombieAssets();
            if (!success) {
                console.error("Failed to load zombie assets");
            }
            return success;
        } catch (error) {
            console.error("Error loading enemy assets:", error);
            return false;
        }
    }
    
    update(deltaTime) {
        if (!this.enabled) return;
        
        // Check if we should spawn new enemies
        const currentTime = performance.now() / 1000;
        if (currentTime - this.lastSpawnTime > this.spawnCooldown) {
            this.trySpawnEnemy();
            this.lastSpawnTime = currentTime;
        }
        
        // Clean up dead enemies
        this.enemies = this.enemies.filter(enemy => enemy.isAlive);
    }
    
    trySpawnEnemy() {
        // Don't spawn if we reached the maximum
        if (this.enemies.length >= this.maxEnemies) return;
        
        // Get player position
        const player = this.engine.player;
        if (!player) return;
        
        // Find a spawn point that's not too close to the player
        const spawnPoint = this.getValidSpawnPoint(player.position);
        if (!spawnPoint) return;
        
        // Create new zombie
        this.spawnZombie(spawnPoint);
    }
    
    async spawnZombie(position) {
        try {
            // Create zombie
            const zombie = new Zombie(this.engine, position);
            
            // Initialize zombie
            await zombie.init(this.engine);
            
            // Add to entity manager and enemies list
            this.engine.entityManager.addEntity(zombie);
            this.enemies.push(zombie);
            
            console.log(`Spawned zombie at ${position.x}, ${position.y}, ${position.z}`);
        } catch (error) {
            console.error("Failed to spawn zombie:", error);
        }
    }
    
    getValidSpawnPoint(playerPosition) {
        // If we have predefined spawn points, use those
        if (this.spawnPoints.length > 0) {
            // Filter spawn points that are far enough from player
            const validSpawnPoints = this.spawnPoints.filter(point => 
                point.distanceTo(playerPosition) > 15
            );
            
            if (validSpawnPoints.length > 0) {
                // Return a random valid spawn point
                return validSpawnPoints[Math.floor(Math.random() * validSpawnPoints.length)];
            }
        }
        
        // Fallback: generate a random position around the player but not too close
        const angle = Math.random() * Math.PI * 2;
        const distance = 20 + Math.random() * 10; // Between 20-30 units away
        
        return new Vector3(
            playerPosition.x + Math.cos(angle) * distance,
            playerPosition.y,
            playerPosition.z + Math.sin(angle) * distance
        );
    }
    
    setSpawnPoints(points) {
        this.spawnPoints = points;
    }
    
    clear() {
        // Remove all enemies
        for (const enemy of this.enemies) {
            this.engine.entityManager.removeEntity(enemy);
        }
        this.enemies = [];
    }
}