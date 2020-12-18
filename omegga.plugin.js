const net = require("net");

class CrossServerChat {
    constructor(omegga, config, store) {
        this.omegga = omegga;
        this.config = config;
        this.store = store;
    }

    relayPacket(data, f) {
        console.log(`Total connection count: ${this.connections.length}`);
        this.connections.filter(c => c.connection != f).forEach(c => c.connection.write(data));
    }

    connect() {
        if (this.hosting) {
            this.connections = [];
            this.server = net.createServer(c => this.handleConnection(c));
            this.server.listen(this.config.port);
        } else {
            this.client = new net.Socket();
            this.handshakeReceived = false;
            this.serverName = null;
            this.client.connect(this.config.port, this.config.ip, () => {
                // send the handshake
                this.client.write(JSON.stringify({"type": "handshake", "name": this.config.name, "playerCount": this.omegga.getPlayers().length, "color": this.config.color}));

                this.client.on("data", (data) => {
                    const packet = JSON.parse(data);

                    if (packet.type == "message") {
                        this.omegga.broadcast(`<color="${packet.color}">${packet.prefix} <b>${packet.name}</b></color>: ${packet.message}`);
                    } else if (packet.type == "acknowledge") {
                        if (this.handshakeReceived) {
                            // we already received a handshake! ignore (todo: error handling)
                            return;
                        }

                        this.handshakeReceived = true;
                        this.serverName = packet.name;

                        this.omegga.broadcast(`<color="${this.config.color}">Connected to <color="${packet.color}"><b>${packet.name}</b></color>, with ${packet.totalConnections - 1} other connections.</color>`);
                    } else if (packet.type == "connection") {
                        this.omegga.broadcast(`<color="${packet.color}"><b>${packet.name}</b></color> <color="${this.config.color}">has connected to chat with ${packet.playerCount} players online.</color>`);
                    } else if (packet.type == "disconnection") {
                        this.omegga.broadcast(`<color="${this.config.color}"><b>${packet.name}</b> has disconnected from chat.</color>`)
                    } else if (packet.type == "join") {
                        this.omegga.broadcast(`<color="${packet.color}">${packet.prefix} <b>${packet.name}</b> has joined <b>${packet.serverName}</b>.</color>`);
                    } else if (packet.type == "leave") {
                        this.omegga.broadcast(`<color="${packet.color}">${packet.prefix} <b>${packet.name}</b> has left <b>${packet.serverName}</b>.</color>`);
                    }
                });

                this.client.on("close", () => {
                    this.omegga.broadcast(`<color="${this.config.color}"><b>Connection closed with chat.</b> Reconnect using <code>!chat:reconnect</code>.</color>`);
                    this.waitToReconnect();
                });
            });
        }
    }

    waitToReconnect() {
        if (this.reconnectTimeout != null && this.reconnectTimeout != undefined) return;
        if (this.config["reconnect-interval"] <= 0) return;

        this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            if (this.client.readyState != "open")
                this.connect();
        }, this.config["reconnect-interval"] * 1000);
    }

    disconnect(attemptToReconnect) {
        if (this.hosting) {
            if (this.server != null) {
                this.connections.forEach(c => c.connection.destroy());
                this.server.close();
            }
        } else {
            if (this.client != null) this.client.destroy();
            if (attemptToReconnect)
                this.waitToReconnect();
        }
    }

    handleConnection(c) {
        console.log("New connection. Anticipating handshake...");

        const connectionWrapper = {"connection": c, "receivedHandshake": false, "name": null};
        this.connections.push(connectionWrapper);

        c.on("data", data => {
            const packet = JSON.parse(data);

            if (packet.type == "handshake") {

                connectionWrapper.receivedHandshake = true;
                connectionWrapper.name = packet.name;
                c.write(JSON.stringify({"type": "acknowledge", "name": this.config.name, "totalConnections": this.connections.length, "color": this.config.color}));

                this.omegga.broadcast(`<color="${packet.color}"><b>${packet.name}</b></color> <color="${this.config.color}">has connected to chat with ${packet.playerCount} players online.</color>`);
                this.relayPacket(JSON.stringify({"type": "connection", "name": packet.name, "playerCount": packet.playerCount, "color": packet.color}), c);

            } else if (packet.type == "message") {

                this.relayPacket(data, c);
                this.omegga.broadcast(`<color="${packet.color}">${packet.prefix} <b>${packet.name}</b></color>: ${packet.message}`);

            } else if (packet.type == "join") {

                this.relayPacket(data, c);
                this.omegga.broadcast(`<color="${packet.color}">${packet.prefix} <b>${packet.name}</b> has joined <b>${packet.serverName}</b>.</color>`);

            } else if (packet.type == "leave") {

                this.relayPacket(data, c);
                this.omegga.broadcast(`<color="${packet.color}">${packet.prefix} <b>${packet.name}</b> has left <b>${packet.serverName}</b>.</color>`);

            }
        });

        c.on("close", () => {
            this.connections.splice(this.connections.indexOf(connectionWrapper), 1);

            this.omegga.broadcast(`<color="${this.config.color}"><b>${connectionWrapper.name}</b> has disconnected from chat.</color>`);
            this.relayPacket(JSON.stringify({"type": "disconnection", "name": connectionWrapper.name}), c);
        });
    }

    async init() {
        this.hosting = this.config.hosting;

        try {
            this.connect();
        } catch (e) {
            console.log("Error connecting: " + e);
            this.omegga.broadcast(`<color="${this.config.color}">Error connecting to chat. Reconnect using <code>!chat:reconnect</code></color>`);
        }

        this.omegga.on("chat", (name, message) => {
            const packet = {"type": "message", "name": name, "message": message, "color": this.config.color, "prefix": this.config.prefix}

            if (this.hosting) {
                if (this.server == undefined || !this.server.listening) return;
                this.connections.forEach(c => c.connection.write(JSON.stringify(packet)));
            } else {
                if (this.client == undefined || this.client.readyState != "open") return;
                this.client.write(JSON.stringify(packet));
            }
        });

        this.omegga.on("join", (player) => {
            const packet = {"type": "join", "name": player.name, "color": this.config.color, "prefix": this.config.prefix, "serverName": this.config.name};

            if (this.hosting) {
                if (this.server == undefined || !this.server.listening) return;
                this.connections.forEach(c => c.connection.write(JSON.stringify(packet)));
            } else {
                if (this.client == undefined || this.client.readyState != "open") return;
                this.client.write(JSON.stringify(packet));
            }
        });

        this.omegga.on("leave", (player) => {
            const packet = {"type": "leave", "name": player.name, "color": this.config.color, "prefix": this.config.prefix, "serverName": this.config.name};

            if (this.hosting) {
                if (this.server == undefined || !this.server.listening) return;
                this.connections.forEach(c => c.connection.write(JSON.stringify(packet)));
            } else {
                if (this.client == undefined || this.client.readyState != "open") return;
                this.client.write(JSON.stringify(packet));
            }
        });

        this.omegga.on("chatcmd:chat:reconnect", (name) => {
            if (!this.omegga.getPlayer(name).isHost() || !this.config["reconnect-authorized"].split(",").map((n) => n.trim().toLowerCase()).includes(name.toLowerCase())) return;

            console.log("Attempting to reconnect...");
            this.disconnect(false); // we are manually going to reconnect immediately after
            this.connect();
        });
    }

    async stop() {
        this.disconnect(false);
    }
}

module.exports = CrossServerChat;
