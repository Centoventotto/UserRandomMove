# UserRandomMove

An [Equicord](https://github.com/Equicord/Equicord) user plugin that adds a **Random Move** button to the context menu of users connected to a voice channel.

When clicked, the selected user is moved, in a random order, through every voice channel of the server where you have the permission to move members, **twice** in total. Each round is shuffled separately and the user is never "moved" into the channel they are already in.

## Features

- **Random Move** button in the user context menu (right click on a user in voice).
- The button is only shown when:
  - you are connected to a voice channel;
  - the target user is in a voice channel of a server;
  - you have the `Move Members` permission in the target user's channel;
  - there is at least one other voice channel where you have `View Channel`, `Connect` and `Move Members`.
- Two shuffled rounds through all the movable voice channels.
- While a Random Move is running, the button becomes **Stop Random Move** to cancel it.
- Stops automatically if the user leaves voice.
- Handles Discord rate limits (waits `retry_after` and retries).

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| Delay | `1000` | Delay between each move, in milliseconds. Lower values may hit Discord rate limits. |
| Return to original channel | `true` | Moves the user back to the voice channel they were in once finished. |

## Installation

This is a user plugin, so you need to build Equicord from source.

1. Follow the [Equicord guide](https://github.com/Equicord/Equicord#installing--uninstalling) to clone and build Equicord.
2. Add the plugin to the `src/userplugins` folder, either:
   - by downloading `UserRandomMove.zip` from the [latest release](https://github.com/centoventotto/UserRandomMove/releases/latest) and extracting it into `Equicord/src/userplugins`, or
   - by cloning this repository there:
     ```sh
     cd Equicord/src/userplugins
     git clone https://github.com/centoventotto/UserRandomMove.git
     ```
3. Rebuild and inject Equicord:
   ```sh
   pnpm build
   pnpm inject
   ```
4. Restart Discord and enable **UserRandomMove** in the plugin settings.

## Disclaimer

Client mods are against Discord's Terms of Service. Use this plugin responsibly and only on servers where moving members is part of your role.

## License

[GPL-3.0-or-later](LICENSE)
