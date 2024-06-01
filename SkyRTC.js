import { Server as WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { inherits } from 'util';
var errorCb = function(rtc) {
	return function(error) {
		if (error) {
			rtc.emit("error", error);
		}
	};
};

class SkyRTC {
	constructor() {
		this.sockets = [];
		this.rooms = {};
		this.on('__join', function (data, socket) {
			console.log(this.sockets.length);
			var ids = [], i, m, room = data.room || "__default", curSocket, curRoom;
			curRoom = this.rooms[room] = this.rooms[room] || [];
			for (i = 0, m = curRoom.length; i < m; i++) {
				curSocket = curRoom[i];
				if (curSocket.id === socket.id) {
					continue;
				}
				ids.push(curSocket.id);
				curSocket.send(JSON.stringify({
					"eventName": "_new_peer",
					"data": {"socketId": socket.id}
				}), errorCb);
			}

			curRoom.push(socket);
			socket.room = room;

			socket.send(JSON.stringify({
				"eventName": "_peers",
				"data": {
					"connections": ids,
					"you": socket.id
				}
			}), errorCb);

			this.emit('new_peer', socket, room);
		});

		this.on('__ice_candidate', function (data, socket) {
			var soc = this.getSocket(data.socketId);
			if (soc) {
				soc.send(JSON.stringify({
					"eventName": "_ice_candidate",
					"data": {
						"label": data.label,
						"candidate": data.candidate,
						"socketId": socket.id
					}
				}), errorCb);
				this.emit('ice_candidate', socket, data);
			}
		});

		this.on('__offer', function (data, socket) {
			var soc = this.getSocket(data.socketId);
			if (soc) {
				soc.send(JSON.stringify({
					"eventName": "_offer",
					"data": {
						"sdp": data.sdp,
						"socketId": socket.id
					}
				}), errorCb);
			}
			this.emit('offer', socket, data);
		});

		this.on('__answer', function (data, socket) {
			var soc = this.getSocket(data.socketId);
			if (soc) {
				soc.send(JSON.stringify({
					"eventName": "_answer",
					"data": {
						"sdp": data.sdp,
						"socketId": socket.id
					}
				}), errorCb);
				this.emit('answer', socket, data);
			}
		});
	}
	addSocket(socket) {
		this.sockets.push(socket);
	}
	removeSocket(socket) {
		var i = this.sockets.indexOf(socket), room = socket.room;
		this.sockets.splice(i, 1);
		if (room) {
			i = this.rooms[room].indexOf(socket);
			this.rooms[room].splice(i, 1);
			if (this.rooms[room].length === 0) {
				delete this.rooms[room];
			}
		}
	}
	broadcast(data, errorCb) {
		var i;
		for (i = this.sockets.length; i--;) {
			this.sockets[i].send(data, errorCb);
		}
	}
	broadcastInRoom(room, data, errorCb) {
		var curRoom = this.rooms[room], i;
		if (curRoom) {
			for (i = curRoom.length; i--;) {
				curRoom[i].send(data, errorCb);
			}
		}
	}
	getRooms() {
		var rooms = [], room;
		for (room in this.rooms) {
			rooms.push(room);
		}
		return rooms;
	}
	getSocket(id) {
		var i, curSocket;
		if (!this.sockets) {
			return;
		}
		for (i = this.sockets.length; i--;) {
			curSocket = this.sockets[i];
			if (id === curSocket.id) {
				return curSocket;
			}
		}
		return;
	}
	init(socket) {
		var that = this;
		socket.id = uuidv4();
		that.addSocket(socket);
		//为新连接绑定事件处理器
		socket.on('message', function (data) {
			var json = JSON.parse(data);
			if (json.eventName) {
				that.emit(json.eventName, json.data, socket);
			} else {
				that.emit("socket_message", socket, data);
			}
		});
		//连接关闭后从SkyRTC实例中移除连接，并通知其他连接
		socket.on('close', function () {
			var i, m, room = socket.room, curRoom;
			if (room) {
				curRoom = that.rooms[room];
				for (i = curRoom.length; i--;) {
					if (curRoom[i].id === socket.id) {
						continue;
					}
					curRoom[i].send(JSON.stringify({
						"eventName": "_remove_peer",
						"data": { "socketId": socket.id }
					}), errorCb);
				}
			}
			that.removeSocket(socket);
			that.emit('remove_peer', socket.id, that);
		});
		that.emit('new_connect', socket);
	}
}


inherits(SkyRTC, EventEmitter);


export function listen(server) {
	var SkyRTCServer;
	if (typeof server === 'number') {
		SkyRTCServer = new WebSocketServer({
			port: server
		});
	} else {
		SkyRTCServer = new WebSocketServer({
			server: server
		});
	}

	SkyRTCServer.rtc = new SkyRTC();
	errorCb = errorCb(SkyRTCServer.rtc);
	SkyRTCServer.on('connection', function(socket) {
		this.rtc.init(socket);
	});

	return SkyRTCServer;
}