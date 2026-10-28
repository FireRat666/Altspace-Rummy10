# Rummy10

A synced multiplayer Rummy10 table for 2 to 10 players. Made for **SideQuest / AltspaceVR** worlds, and it also works in **Banter**.

There is no server: players stay in sync through the space's shared state, and the game is plain static files served from <https://rummy10.firer.at>.

To try it, open <https://rummy10.firer.at> in Altspace or Banter.

## Features

- Hands and turns handled for you
- Host migration and disconnect handling

## Add it to an Altspace world (snippet)

In a Creator SDK world, add an empty GameObject at the origin, click **Add Component > BS > Snippet** and type `rummy10`. Or paste this into `Assets/WebRoot/index.html`, between the snippet section comments:

```html
<!-- snippet section -->
<bs-snippet name="rummy10" title="Rummy10"
  description="Synced multiplayer Rummy10 table."
  script="https://rummy10.firer.at/snippet.js"
  room=""
  position="0 0 3"
  rotation="0 0 0"
  sound-volume="0.4"
  sound-near="2.5"
  sound-far="10"
  debug="false">
  <bs-gizmo type="position" attribute="position"/>
  <bs-gizmo type="plane" attribute="position" size="3.2 3.2" rotation="90 0 0"/>
</bs-snippet>
<!-- end snippet section -->
```

- Each placement is its own game. Its sync id is `room`, or the placement's own id when `room` is empty. Give placements the same `room` to share one game.
- `position` and `rotation` are Unity world values. The other settings are listed under [Settings](#settings). An empty setting uses the default.
- The Scene-view gizmo shows the table footprint.
- Unity reads the snippet section as XML: quote every attribute, close every element, and write `&` as `&amp;`.

## Add it with a script tag

This works in an Altspace world's `Assets/WebRoot/index.html` (outside the snippet section) and in a Banter space's HTML:

```html
<script src="https://rummy10.firer.at/rummy10.js" position="0 0 2" rotation="0 180 0" instance="lobby-rummy10"></script>
```

For more than one table in a space, give each one its own `instance`:

```html
<script src="https://rummy10.firer.at/rummy10.js" instance="table1" position="-4 0 0"></script>
<script src="https://rummy10.firer.at/rummy10.js" instance="table2" position="4 0 0"></script>
```

## Settings

| Setting | Also accepted | Default | Description |
| :--- | :--- | :--- | :--- |
| `instance` |  | `demo-rummy10` | Sync id. Tables with the same id share one game. In a snippet, use `room` instead. |
| `sound-volume` |  | `0.4` | Volume of the sound effects, from `0` to `1`, heard at full strength near the table. `0` turns them off. |
| `sound-near` |  | `2.5` | Distance in metres from the table within which the sounds play at full volume. |
| `sound-far` |  | `10` | Distance in metres at which the sounds have faded out completely, so people elsewhere in the world aren't disturbed. |
| `position` |  | `0 0 0` | Table position (x y z). |
| `rotation` |  | `0 0 0` | Table rotation in degrees (x y z). |
| `debug` |  | `false` | `true` logs extra detail to the console. |

## Files

- `rummy10.js`: the game.
- `Assets/`: sounds.
- `snippet.js`, `snippet.html`: the Creator SDK snippet and its definition.
- `index.html`: a test page with a floor and the game.

## Credits

Based on [UNO](https://github.com/FireRat666/Banter-Uno). The sounds come from the original Holograms Against Humanity project.

## License

GPL-3.0. See [LICENSE](LICENSE).
