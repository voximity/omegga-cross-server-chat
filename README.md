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

## Specification

The host server is responsible for initiating a TCP server. Client instances are responsible for establishing a connection and sending/receiving information after the host server acknowledges its handshake.

A packet is a JSON object that always includes the field `type`, representing the type of packet. Each packet type has expected information to follow. See below for a table of packets and their types.

### Packet types

| **Comes from** | **Packet type** | **Extra fields** | **Description** |
| --- | --- | --- | --- |
| client | `handshake` | `version`, `name`, `color`, `prefix`, `playerCount` | The handshake is soon as the client makes connection with the host server. The client is expected to send some information about their server instance. `playerCount` is only used once at connection, so it does not need to be updated. The `version` field is expected to be the same as that of the server's. If it is not, the client connection will be closed. |
| host | `acknowledge` | `identifier`, `hostIdentifier`, `connections.identifier`, `connections.name`, `connections.color`, `connections.prefix`, `playerCount` | The acknowledge packet is sent in response to the `handshake` packet. If the client does not receive an `acknowledge` packet in response, the connection was unsuccessful. Included is `identifer`, representing the identifier used to distinguish the connecting client from other clients. Clients should store this value as well as `hostIdentifier`, the identifier of the host server, as well as all connections passed in the `connections` array. Clients are expected to maintain an up-to-date directory of connections. The host server will send updates about individual connections as they change. |
| host | `connection` | `identifier`, `name`, `color`, `prefix`, `playerCount` | The host sends this packet when a new client connects to the host server. The client should store this information in its internal connections array, except for the `playerCount` field, which is only used for immediately displaying the connection to other servers. |
| host | `disconnect` | `identifier` | The host sends this packet when a client disconnects from the host. The included identifier is the disconnecting client. The client *should* have this client already stored in its internal connections array. Remove it if it exists. |
| both | `join` | `identifier`, `username` | Both instance types (clients and hosts) can send this packet. It is sent when a player joins one of the connected servers. The `identifier` is the identifier of the instance sending the packet. If the sending instance is a client, then the packet will be relayed to all other clients after being processed by the host server. |
| both | `leave` | `identifier`, `username` | Similar to `join`, this is sent when a player leaves a server. See above for more information. |
| both | `message` | `identifer`, `username`, `content` | Similar to `join` and `leave`, this is sent when a user sends a message on a server. The field `content` is expected to be sanitized by the instance sending the packet, NOT the receiving instances. |

### Connections and disconnects

When a client connects/disconnects from the host server, the host server will distribute `connection` and `disconnect` packets respectively. The client does not need to inform the host server of a disconnect, a close of the connection will work.
