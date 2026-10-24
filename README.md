# Banter Rummy10!

A fully functional Rummy10 game for Banter spaces.

## Features
- Support for 2-10 players.
- Persistent state management via BanterSpace.
- Configurable position, rotation, and instance names.
- Automatic hand management and turn handling.

## How to add to your space

To add Rummy10 to your Banter space, simply include the `rummy10.js` script in your HTML file. You can configure its placement and behavior using attributes on the `<script>` tag.

### Basic Implementation

```html
<script src="https://rummy10.firer.at/rummy10.js"
        position="0 0 0"
        rotation="0 0 0"
        instance="my-rummy10-game"></script>
```

### Script Parameters

| Parameter | Default | Description |
| :--- | :--- | :--- |
| `position` | `0 0 2` | The world position where the Rummy10 table will be spawned (X Y Z). |
| `rotation` | `0 0 0` | The rotation of the Rummy10 table (Euler angles: X Y Z). |
| `instance` | `demo-rummy10` | A unique identifier for the game state. Use different instance IDs if you want multiple independent games in the same space. |
| `debug` | `false` | Enables debug logging in the console if set to `true`. |

## SideQuest / Altspace Creator SDK (Snippet)

In a SideQuest/Altspace Creator SDK world, add an empty GameObject at the origin, click **Add Component > BS > Snippet** and type `rummy10`. Or paste it into `Assets/WebRoot/index.html` between the snippet section comments:

```html
<!-- snippet section -->
<bs-snippet name="rummy10" title="Rummy10"
  description="Synced multiplayer Rummy10 table."
  script="https://rummy10.firer.at/snippet.js"
  room=""
  position="0 0 3"
  rotation="0 0 0"
  debug="false">
  <bs-gizmo type="position" attribute="position"/>
  <bs-gizmo type="plane" attribute="position" size="3.2 3.2" rotation="90 0 0"/>
</bs-snippet>
<!-- end snippet section -->
```

- Settings are the same as the script attributes above. `position` and `rotation` are Unity world values.
- Each placement is its own game. Its sync id is `room`, or the placement's own id when `room` is empty. Give placements the same `room` to share one game.
- An empty setting uses the game's default.
- The Scene-view gizmo shows the table footprint.
- Unity reads the snippet section as XML: quote every attribute, close every element, and write `&` as `&amp;`.

## Example `index.html`

```html
<!DOCTYPE html>
<html>
  <head>
    <meta property="og:title" content="My Banter Space">
  </head>
  <body>
    <!-- Load Rummy10 Game -->
    <script src="https://rummy10.firer.at/rummy10.js"
            position="0 0 2"
            rotation="0 180 0"
            instance="lobby-rummy10"></script>
  </body>
</html>
```

## Attribution

This Rummy10 game is based on previous works:
https://github.com/FireRat666/Banter-UNO

The sound assets used in this project are derived from the original "Holograms Against Humanity" project.

## How it works

The game uses the Banter SDK to create game objects, UI elements, and manage network state.

1. **Initialization**: The script reads parameters from its own tag or URL search params.
2. **Environment**: It builds the Rummy10 table, card deck, and player areas.
3. **State**: Game state is synchronized across all players using `BS.BanterScene` state events.
4. **Turns**: Players take turns playing cards or drawing from the deck. The game automatically handles special cards like Skip, Reverse, and Wild cards.
