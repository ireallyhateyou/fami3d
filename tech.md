# Adding 3D visualization to a web NES emulator
Try the tech demo here 

Why?

- It's a good and interesting technical demo
- it looks cool
- VR can be done

How?

The NES renders its pictures using a PPU (Picture Processing Unit https://www.nesdev.org/wiki/PPU).

The PPU is tasked with rendering a game using two types of 8x8 tiles, one being background tiles and the other being sprites made out tiles (i.e. characters).

The sprite tiles are also assigned two (priority levels https://www.nesdev.org/wiki/PPU_sprite_priority): 0 for sprites in front of the background tiles and 1 for sprites behind the background tiles.

By reading data from the PPU, we can render three canvases for background tiles, priority-zero sprites and priority-one sprites. Using three.js, we can position these layers in 3D space (y=-1 for sprites behind the background, y=0 for background tiles, y=1 for sprites in front).

This allows us to have (albeit very shoddy and unimpressive) 3D rendering for the NES, we can go further by filtering the background colour (i.e. the sky) from other background tiles (bricks, pipes, etc...) and applying it to the entire 3D scene. 

From that, we can add pixel-level extrusion to the tiles and sprites which allows us to have visualization. This approach was first thought up by a FCEUX plugin named (FCE3D https://github.com/HerbFargus/FCE3D).

Since the NES does not distinguish between "background pixels" apart, we used an extremely shoddy approach: sample a "neutral" pixel (in this case, x=4 y=4) and pray that it is the background colour. Based on that colour, we can filter it out and extrude accordingly.

The approach:
We are making about 185,000 voxels, hence comes the need for optimization.

For tiles, we can calculate their pixel-level extrusion once then reuse a cache. Furthermore, rather than projecting the pixel onto the voxels directly, we made each tile reflect their average colour before layering the canvases onto them as a transparent flat plane.

How could we go further from this:
Use a local model for depth extrusion, currently we only extrude based on whether the pixel is part of the background or not. 

We could envision the use of depth estimation models like (MiDaS https://github.com/isl-org/MiDaS) or (FLUX.1 https://bfl.ai/announcements/24-11-21-tools) to generate a depth map for each sprite, possibly fine-tuned from previously-made 3D renders of games.
