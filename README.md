# omegga-cross-server-chat

This is a cross server chat utility for Omegga. Each server you wish to connect with each other must have this plugin installed.

## Installation

`cd plugins`

`git clone git://github.com/voximity/omegga-cross-server-chat.git`

Reload all plugins through the Omegga UI.

## Configuration

omega-cross-server-chat expects one server to be the host server, hosting the TCP server for chatting. Pick one server to do this, and follow below for host and client servers respectively

### Host server (single)

Enable `hosting` in the config. The `ip` field is not important in this case.

Set `port` to whatever you wish, but if the servers you wish to communicate between are not
on the same local network, the host server must port forward the port you choose. Set it accordingly.

### Client server (all others)

Ensure `hosting` is disabled in the config. Set the `ip` to the internal or external IP of the host server.
If you are on the same network, it should be the internal IP. Otherwise, it should be the external IP.

Set `port` to the port that the host server is running out of.

### Common configuration

The `name` field is the display name of the server when it is connected. It will be shown when that server connects to the host server and when players connect to the server.
Typically, you can keep it the same as the server name on Brickadia.

The `color` field is a hex code of the color representing your server (e.g. `00aaff`). It is shown for chat names and prompts having to do with your server.

The `prefix` field is placed before all chats from your server to others, as well as joins and leaves. Typically, it is nice to make it something small, like `[x]`. This would make messages display
as `[x] user: message`.

## Usage

If the server is the host server, then the chat server will start when the plugin is loaded/reloaded. This must happen first before all client servers.

If the server is a client server, then it will attempt to establish a connection with the hostname and port you set in the config. Ensure this happens after the host server is up and running.

To reconnect at any time (during a connection or after losing one), run the `!chat:reconnect` command as host.