const net = require("net");
const {chat: {EMOTES, parseLinks}} = OMEGGA_UTIL;

const TEXT_COLOR = (color) => `<color="${color}">`;
const PROTOCOL_VERSION = 1;

// An abstract class representing both the host server and client server
class ConnectionInstance {
    constructor(name, color, prefix) {
        this.name = name;
        this.color = color;
        this.prefix = prefix;
        this.connections = [];
    }

    getConnection(identifier) {
        return this.connections.find((c) => c.identifier == identifier);
    }

    removeConnection(identifier) {
        this.connections.splice(this.connections.indexOf(this.getConnection(identifier)), 1);
    }

    start(playerCount) {}

    handlePacket(packet, isHost) {
        if (packet.type == "connection") {
            // New connection to the host server
            const newConnection = isHost ? this.getConnection(packet.identifier) : {identifier: packet.identifier, name: packet.name, color: packet.color, prefix: packet.prefix};
            if (!isHost) this.connections.push(newConnection);

            // Display in chat
            const {prefix, color, name} = newConnection;
            Omegga.broadcast(`${TEXT_COLOR(color)}${prefix} <b>${name}</> has connected to chat with ${packet.playerCount} players online.</>`);
        } else if (packet.type == "disconnect") {
            // A connection was closed with the host server
            const {prefix, name, color} = this.getConnection(packet.identifier);
            Omegga.broadcast(`${TEXT_COLOR(color)}${prefix} <b>${name}</> has disconnected from chat.</>`);
            this.removeConnection(packet.identifier);
        } else if (packet.type == "join") {
            // A player joined another connection on the host server
            const {name, color, prefix} = this.getConnection(packet.identifier);
            Omegga.broadcast(`${TEXT_COLOR(color)}${prefix} <b>${packet.username}</> has joined <b>${name}</>.</>`);
        } else if (packet.type == "leave") {
            // A player left another connection on the host server
            const {name, color, prefix} = this.getConnection(packet.identifier);
            Omegga.broadcast(`${TEXT_COLOR(color)}${prefix} <b>${packet.username}</> has left <b>${name}</>.</>`);
        } else if (packet.type == "message") {
            // A player sent a message on another connection on the host server
            const {color, prefix} = this.getConnection(packet.identifier);
            Omegga.broadcast(`${TEXT_COLOR(color)}${prefix} <b>${packet.username}</>:</> ${packet.content}`);
        }
    }

    sendJoinPacket(username) {}
    sendLeavePacket(username) {}
    sendMessagePacket(username, content) {}

    disconnect(shouldReconnect) {}
}

// The host server derivation of the above class
class HostServerInstance extends ConnectionInstance {
    constructor(name, color, prefix, port) {
        super(name, color, prefix);
        this.port = port;
        this.server = net.createServer(c => this.handleConnection(c));
        this.version = PROTOCOL_VERSION;
        console.log("INFO: host server started");
    }

    start(playerCount) {
        this.connections = [];
        this.identifier = 0;
        this.hostIdentifier = 0;
        this.currentIdentifier = 1;
        this.server.listen(this.port);
    }

    sendPacketToAll(packet, except) {
        this.connections.forEach((c) => {
            if (except == c.identifier)
                return;
            c.connection.write(JSON.stringify(packet))
        });
    }

    handleConnection(connection) {
        // New connection. Develop its connection object.
        const context = {connection, identifier: this.currentIdentifier++, name: null, prefix: null, color: null, receivedHandshake: false};
        this.connections.push(context);

        connection.on("data", (data) => {
            const packet = JSON.parse(data);
            if (!context.receivedHandshake && packet.type != "handshake") {
                console.log(`ERROR: connection ${context.identifier} sent non-handshake packet before sending handshake`);
                connection.destroy();
                return;
            }

            if (packet.type == "handshake") {
                console.log(`INFO: received handshake from connection ID ${context.identifier}`);

                if (!packet.version || packet.version != PROTOCOL_VERSION) {
                    console.log(`ERROR: connection ${context.identifier} handshake sent an invalid protocol version (host ${PROTOCOL_VERSION}, client ${packet.version})`);
                    connection.destroy();
                    return;
                }

                context.receivedHandshake = true;

                // Create the ack packet
                const responsePacket = {type: "acknowledge", identifier: context.identifier, hostIdentifier: this.identifier, playerCount: Omegga.getPlayers().length, connections: [...this.connections.map((c) => ({identifier: c.identifier, name: c.name, color: c.color, prefix: c.prefix})), {identifier: this.identifier, name: this.name, color: this.color, prefix: this.prefix}]};

                // Write it to the connection
                connection.write(JSON.stringify(responsePacket));

                // Create the connection packet for other connections
                context.name = packet.name;
                context.color = packet.color;
                context.prefix = packet.prefix;
                const connectionPacket = {type: "connection", identifier: context.identifier, name: context.name, color: context.color, prefix: context.prefix, playerCount: packet.playerCount};

                // Handle it ourselves
                this.handlePacket(connectionPacket, true);

                // Distribute to other connections (not the new one)
                this.sendPacketToAll(connectionPacket, context.identifer);
            } else {
                const validPackets = ["join", "leave", "message"];
                if (!validPackets.includes(packet.type)) {
                    console.log(`WARN: connection ID ${context.identifier} sent invalid packet type "${packet.type}"`);
                    return;
                }

                // Handle it ourselves
                this.handlePacket(packet, true);

                // Distribute the packet except for the one that sent it
                this.sendPacketToAll(packet, context.identifier);
            }
        });

        connection.on("close", () => {
            // Create the disconnect packet
            const disconnectPacket = {type: "disconnect", identifier: context.identifier};

            // Handle the disconnect packet ourselves (this will remove it)
            this.handlePacket(disconnectPacket, true);

            // Distribute the packet (no need for exclusions, the connection is already removed)
            this.sendPacketToAll(disconnectPacket);
        });
    }

    sendJoinPacket(username) {
        const joinPacket = {type: "join", identifier: this.identifier, username};
        this.sendPacketToAll(joinPacket, []);
    }

    sendLeavePacket(username) {
        const leavePacket = {type: "leave", identifier: this.identifier, username};
        this.sendPacketToAll(leavePacket, []);
    }

    sendMessagePacket(username, content) {
        const messagePacket = {type: "message", identifier: this.identifier, username, content};
        this.sendPacketToAll(messagePacket, []);
    }

    disconnect() {
        this.connections.forEach((c) => c.connection.destroy());
        this.server.close();
    }
}

// The client server derivation of ConnectionInstance.
class ClientInstance extends ConnectionInstance {
    constructor(name, color, prefix, ip, port, reconnectInterval) {
        super(name, color, prefix);
        this.ip = ip;
        this.port = port;
        this.client = new net.Socket();
        this.acknowledgeReceived = false;
        this.reconnectInterval = reconnectInterval <= 0 ? 15 : reconnectInterval;
        this.reconnectTimeout = null;
    }

    sendPacket(packet) {
        if (!this.client || this.client.readyState != "open") return;
        this.client.write(JSON.stringify(packet));
    }

    start(playerCount) {
        this.client.connect(this.port, this.ip, () => {
            // Send the handshake
            const handshakePacket = {type: "handshake", version: PROTOCOL_VERSION, name: this.name, color: this.color, prefix: this.prefix, playerCount};
            this.sendPacket(handshakePacket);

            this.client.on("data", (data) => {
                const packet = JSON.parse(data);
                if (!this.acknowledgeReceived && packet.type != "acknowledge") {
                    console.log("FATAL: received non-ack packet before receiving ack");
                    this.client.destroy();
                    return;
                }

                if (packet.type == "acknowledge") {
                    if (this.acknowledgeReceived) {
                        console.log("FATAL: received ack packet more than once");
                        this.client.destroy();
                        return;
                    }
                    this.identifier = packet.identifier;
                    this.hostIdentifier = packet.hostIdentifier;
                    this.connections = packet.connections;
                    this.acknowledgeReceived = true;
                    console.log("INFO: received acknowledge from host server");

                    const hostConnection = this.getConnection(this.hostIdentifier);
                    Omegga.broadcast(`${TEXT_COLOR(hostConnection.color)}Connected to host chat <b>${hostConnection.name}</> with ${packet.playerCount} players online.</>`);
                } else {
                    // Handle packets normally
                    this.handlePacket(packet);
                }
            });

            this.client.on("close", () => {
                Omegga.broadcast(`${TEXT_COLOR(this.color)}Disconnected from chat.</>`);
                this.disconnect(true);
            });
        });
    }

    sendJoinPacket(username) {
        const joinPacket = {type: "join", identifier: this.identifier, username};
        this.sendPacket(joinPacket);
    }

    sendLeavePacket(username) {
        const leavePacket = {type: "leave", identifier: this.identifier, username};
        this.sendPacket(leavePacket);
    }

    sendMessagePacket(username, content) {
        const messagePacket = {type: "message", identifier: this.identifier, username, content};
        this.sendPacket(messagePacket);
    }

    disconnect(attemptToReconnect) {
        if (this.client != null) this.client.destroy();
        if (attemptToReconnect) {
            if (this.reconnectTimeout != null) return; // we are already waiting to reconnect
            this.reconnectTimeout = setTimeout(() => {
                this.reconnectTimeout = null;
                if (this.client.readyState != "open") {
                    this.client = new net.Socket();
                    this.start(Omegga.getPlayers().length);
                }
            }, this.reconnectInterval * 1000);
        }
    }
}

class CrossServerChat {
    constructor(omegga, config, store) {
        this.omegga = omegga;
        this.config = config;
        this.store = store;
    }

    async init() {
        this.connection = null;
        if (this.config.hosting) {
            const {name, color, prefix, port} = this.config;
            this.connection = new HostServerInstance(name, color, prefix, port);
        } else {
            const {name, color, prefix, ip, port} = this.config;
            this.connection = new ClientInstance(name, color, prefix, ip, port, this.config["reconnect-interval"]);
        }

        this.connection.start(Omegga.getPlayers().length);

        Omegga.on("chat", (username, message) => {
            this.connection.sendMessagePacket(username, message);
        });

        Omegga.on("join", (player) => {
            this.connection.sendJoinPacket(player.name);
        });

        Omegga.on("leave", (player) => {
            this.connection.sendLeavePacket(player.name);
        });

        /*Omegga.on("cmd:chat:reconnect", (name) => {
            if (!this.omegga.getPlayer(name).isHost() && !this.config["reconnect-authorized"].split(",").map((n) => n.trim().toLowerCase()).includes(name.toLowerCase())) return;

            console.log(`INFO: ${name} issued a chat reconnect, attempting`);
            this.connection.disconnect(false);
            this.connection.start(Omegga.getPlayers().length);
        });*/

        Omegga.on("cmd:csc", (name, subcommand, ...args) => {
            const hasAuth = this.omegga.getPlayer(name).isHost() || this.config["reconnect-authorized"].split(",").map((n) => n.trim().toLowerCase()).includes(name.toLowerCase());
            const requireAuth = () => {
                if (!hasAuth) {
                    Omegga.whisper(name, "You are not authorized to use that command.");
                    return true;
                }
                return false;
            }

            if (subcommand == "reconnect") {
                if (requireAuth()) return;

                console.log(`INFO: ${name} forced a reconnect, attempting`);
                Omegga.whisper(name, "Attempting to reconnect...");
                this.connection.disconnect(false);
                this.connection.start(Omegga.getPlayers().length);
            } else if (subcommand == "list") {
                Omegga.whisper(name, `${TEXT_COLOR(this.connection.color)}A total of <b>${this.connection.connections.length} connections</> are active.</>`);
                this.connection.connections.forEach((c) => {
                    Omegga.whisper(name, `${TEXT_COLOR("aaaaaa")}(ID ${c.identifier})</> ${TEXT_COLOR(c.color)}${c.prefix} <b>${c.name}</></>${c.identifer == this.connection.hostIdentifier ? ` ${TEXT_COLOR("aaaaaa")}(HOST)</>` : ""}`);
                });
            } else {
                Omegga.whisper(name, "Invalid subcommand.");
            }
        });

        return {registeredCommands: ["csc"]};
    }

    async stop() {
        this.connection.disconnect(false);
    }
}

module.exports = CrossServerChat;
