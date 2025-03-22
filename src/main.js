// src/main.js
import { Engine } from './engine/Engine.js';
import { Vector3 } from 'three';
import { Zombie } from './entities/Zombie.js';
import { PlanetBody } from './physics/PlanetBody.js';

async function initGame() {
    try {
        console.log("Initializing game...");
        
        // Create game engine
        const engine = new Engine({
            debug: true // Enable debug for development
        });
        
        // Initialize engine
        await engine.init();
        
        // Create a planet
        const planetRadius = 40; // Adjust radius as needed
        const planetBody = new PlanetBody({
            radius: planetRadius,
            position: new Vector3(0, -planetRadius, 0), // Center below the player
            gravityStrength: 25 // Adjust to control gravity feel
        });
        
        // Add planet to physics world
        engine.physics.addBody(planetBody);
        
        // Set as the main planet body for gravity
        engine.physics.setPlanetBody(planetBody);
        
        // Load example map
        await engine.loadMap('example_map');
        
        // Start the game
        engine.start();
        console.log("Game started successfully");
        
        // Spawn a test zombie after a short delay
        setTimeout(() => {
            // Create a zombie at a specific position
            const testZombie = new Zombie(engine, new Vector3(5, 0, -5));
            testZombie.init(engine).then(() => {
                engine.entityManager.addEntity(testZombie);
                console.log("Test zombie spawned at", testZombie.position);
            });
        }, 2000);
        
        // Make engine accessible from the console for debugging
        window.engine = engine;
    } catch (error) {
        console.error("Failed to initialize game:", error);
    }
}

// Start the game when page is loaded
window.addEventListener('load', initGame);