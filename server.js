const express = require("express");
const path = require("path");
const https = require("https");
const fs = require("fs");

const mediasoup = require("mediasoup");

const io = require("socket.io")({
  path: "/io/webrtc",
});

const app = express();
const PORT = process.env.PORT || 8888;

// app.get('/', (req, res) => res.send('Hello World!!!!!'))

//https://expressjs.com/en/guide/writing-middleware.html
// console.log(path.join(__dirname, "../client/build/index.html"));
app.use(express.static(path.join(__dirname, "/client/build")));
// app.use(express.static(path.join(__dirname, "../client/public")));
// app.use(express.static())
app.get("/", (req, res, next) => {
  //default room
  // /home/vikash/Desktop/BASK/bb_video_call/client/build/index.html
  res.sendFile(path.join(__dirname, "/client/build/index.html"));
});

app.get("/:room", (req, res, next) => {
  res.sendFile(path.join(__dirname, "/client/build/index.html"));
});

const options = {
  key: fs.readFileSync("./ssl/keytmp.pem", "utf-8"),
  cert: fs.readFileSync("./ssl/cert.pem", "utf-8"),
  passphrase: "gsahdg",
};

const httpsServer = https.createServer(options, app);

httpsServer.listen(PORT, () =>
  console.log(`Example app listening on port ${PORT}!`),
);

io.listen(httpsServer);

// socket.io namespace (could represent a room?)
const connection = io.of("/mediasoup");

/**
 * Worker
 * |-> Router(s)
 *     |-> Producer Transport(s)
 *         |-> Producer
 *     |-> Consumer Transport(s)
 *         |-> Consumer
 **/

let worker;
let rooms = {}; // { roomName1: { Router, rooms: [ sicketId1, ... ] }, ...}
let peers = {}; // { socketId1: { roomName1, socket, transports = [id1, id2,] }, producers = [id1, id2,] }, consumers = [id1, id2,], peerDetails }, ...}
let transports = []; // [ { socketId1, roomName1, transport, consumer }, ... ]
let producers = []; // [ { socketId1, roomName1, producer, }, ... ]
let consumers = []; // [ { socketId1, roomName1, consumer, }, ... ]

const createWorker = async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 2000,
    rtcMaxPort: 2900,
  });
  console.log(`worker pid ${worker.pid}`);

  worker.on("died", (error) => {
    // This implies something serious happened, so kill the application
    console.error("mediasoup worker has died");
    setTimeout(() => process.exit(1), 2000); // exit in 2 seconds
  });

  return worker;
};

// We create a Worker as soon as our application starts
worker = createWorker();

// This is an Array of RtpCapabilities
// https://mediasoup.org/documentation/v3/mediasoup/rtp-parameters-and-capabilities/#RtpCodecCapability
// list of media codecs supported by mediasoup ...
// https://github.com/versatica/mediasoup/blob/v3/src/supportedRtpCapabilities.ts

const mediaCodecs = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: {
      "x-google-start-bitrate": 1000,
    },
  },
];

connection.on("connection", async (socket) => {
  console.log(socket.id, "person's id");
  socket.emit("connection-success", {
    socketId: socket.id,
  });

  const createRoom = async (roomName, socketId) => {
    try {
      console.log(roomName, "the roomName");
      let router1;
      let peers = [];
      if (rooms[roomName]) {
        router1 = rooms[roomName].router;
        peers = rooms[roomName].peers || [];
      } else {
        router1 = await worker.createRouter({ mediaCodecs });
      }

      console.log(`Router ID: ${router1.id}`, peers.length);

      rooms[roomName] = {
        router: router1,
        peers: [...peers, socketId],
      };
      return router1;
    } catch (err) {
      console.log(err, "the room creation...");
    }
  };

  socket.on("joinRoom", async ({ roomName }, callback) => {
    try {
      // create Router if it does not exist
      const router1 = await createRoom(roomName, socket.id);
      console.log(router1, "from the Create room");

      peers[socket.id] = {
        socket,
        roomName,
        transports: [],
        producers: [],
        consumers: [],
        peerDetails: {
          name: "",
          isAdmin: false,
        },
      };

      // get Router RTP Capabilities
      const rtpCapabilities = router1.rtpCapabilities;

      // call callback from the client and send back the rtpCapabilities
      callback({ rtpCapabilities });
    } catch (err) {
      console.log(err, "from the joinRoom");
    }
  });

  // >>>>>>
  const createWebRtcTransport = async (router) => {
    return new Promise(async (res, rej) => {
      try {
        const webRTcTransport_options = {
          listenIps: [{ ip: "127.0.0.1", announcedIp: "127.0.0.1" }],
          enableUdp: true,
          enableTcp: true,
          preferUdp: true,
        };

        let transport = await router.createWebRtcTransport(
          webRTcTransport_options,
        );
        console.log(
          `transport id: ${transport.id}, creation of webrtctransport`,
        );

        transport.on("dtlsstatechange", (dtlsState) => {
          if (dtlsState === "closed") {
            transport.close();
          }
        });

        transport.on("close", () => {
          console.log("transport closed");
        });
        console.log(transport, "before seding to resolve");
        res(transport);
      } catch (err) {
        console.log(err, "error from the create webRtc Transport");
        rej(err);
      }
    });
  };

  const addTransport = (transport, roomName, consumer) => {
    try {
      transports = [
        ...transports,
        { socketId: socket.id, transport, roomName, consumer },
      ];

      console.log(transports, "added in the transport to transports");

      peers[socket.id] = {
        ...peers[socket.id],
        transports: [...peers[socket.id].transports, transport.id],
      };
      console.log(peers, "added in the transport to peers obj");
    } catch (err) {
      console.log(err, "the addd Transprot");
    }
  };

  socket.on("createWebRtcTransport", async ({ consumer }, callback) => {
    try {
      // get Room Name from Peer's properties
      const roomName = peers[socket.id].roomName;

      // get Router (Room) object this peer is in based on RoomName
      const router = rooms[roomName].router;

      createWebRtcTransport(router)
        .then((transport) => {
          callback({
            params: {
              id: transport.id,
              iceParameters: transport.iceParameters,
              iceCandidates: transport.iceCandidates,
              dtlsParameters: transport.dtlsParameters,
            },
          });

          // add transport to Peer's properties
          addTransport(transport, roomName, consumer);
        })
        .catch((err) => {
          console.log(err, "from the createWebRtcTransport socket.on");
        });
    } catch (err) {
      console.log(err, "the error from the webrtcTransport");
    }
  });

  // >>>>>>>>>>>
  const getTransport = (socketId) => {
    try {
      const [producerTransport] = transports.filter(
        (transport) => transport.socketId === socketId && !transport.consumer,
      );
      console.log(producerTransport, "extracting using square bracket...");
      return producerTransport.transport;
    } catch (err) {
      console.log(err);
    }
  };

  // >>>>>>>>
  const addProducer = (producer, roomName) => {
    try {
      producers = [...producers, { socketId: socket.id, producer, roomName }];

      peers[socket.id] = {
        ...peers[socket.id],
        producers: [...peers[socket.id].producers, producer.id],
      };
    } catch (err) {
      console.log(err);
    }
  };

  // >>>>>>>>>>>>>>
  const addConsumer = (consumer, roomName) => {
    try {
      // add the consumer to the consumers list
      consumers = [...consumers, { socketId: socket.id, consumer, roomName }];

      // add the consumer id to the peers list
      peers[socket.id] = {
        ...peers[socket.id],
        consumers: [...peers[socket.id].consumers, consumer.id],
      };
    } catch (err) {
      console.log(err);
    }
  };

  // >>>>>>>>>>>>
  const informConsumers = (roomName, socketId, id) => {
    try {
      console.log(`just joined, id ${id} ${roomName}, ${socketId}`);
      // A new producer just joined
      // let all consumers to consume this producer
      producers.forEach((producerData) => {
        if (
          producerData.socketId !== socketId &&
          producerData.roomName === roomName
        ) {
          const producerSocket = peers[producerData.socketId].socket;
          // use socket to send producer id to producer
          producerSocket.emit("new-producer", { producerId: id });
        }
      });
    } catch (err) {
      console.log(err);
    }
  };

  // >>>>>>>>>>>
  socket.on(
    "transport-produce",
    async ({ kind, rtpParameters, appData }, callback) => {
      // call produce based on the parameters from the client
      // const producer = await getTransport(socket.id);
      // console.log(producer, "the transport-produce");
      try {
        const producer = await getTransport(socket.id).produce({
          kind,
          rtpParameters,
        });

        // add producer to the producers array
        const { roomName } = peers[socket.id];

        addProducer(producer, roomName);

        informConsumers(roomName, socket.id, producer.id);

        console.log("Producer ID: ", producer.id, producer.kind);

        producer.on("transportclose", () => {
          console.log("transport for this producer closed ");
          producer.close();
        });

        // Send back to the client the Producer's id
        callback({
          id: producer.id,
          producersExist: producers.length > 1 ? true : false,
        });
      } catch (err) {
        console.log(err, "the msg from the transport-produce");
      }
    },
  );

  // >>>>>>>>>>>>

  socket.on("transport-connect", ({ dtlsParameters }) => {
    console.log("DTLS Params....", dtlsParameters);
    try {
      getTransport(socket.id).connect({ dtlsParameters });
    } catch (err) {
      console.log(err, "the msg from the tranpsort-connect");
    }
  });

  // >>>>>>>>>
  socket.on("getProducers", (callback) => {
    //return all producer transports
    try {
      const { roomName } = peers[socket.id];

      let producerList = [];
      producers.forEach((producerData) => {
        if (
          producerData.socketId !== socket.id &&
          producerData.roomName === roomName
        ) {
          producerList.push(producerData.producer.id);
        }
      });

      // return the producer list back to the client
      callback(producerList);
    } catch (err) {
      console.log(err);
    }
  });

  // >>>>>>>>
  socket.on(
    "transport-recv-connect",
    async ({ dtlsParameters, serverConsumerTransportId }) => {
      console.log(
        `DTLS Params recv-connect: ${dtlsParameters}`,
        transports,
        "ladladlaldfald",
      );
      try {
        console.log(serverConsumerTransportId, "the id");
        let [consumerTransport] = transports.filter(
          (transportData) =>
            transportData.consumer &&
            transportData.transport.id == serverConsumerTransportId,
        );
        // console.log(consumerTransport, "its from here pre");
        consumerTransport = consumerTransport.transport;
        console.log(consumerTransport, "its from here");
        await consumerTransport.connect({ dtlsParameters });
      } catch (err) {
        console.log(err, "the msg is from the transport-recv-connect");
      }
    },
  );

  // >>>>>>>>>
  socket.on(
    "consume",
    async (
      { rtpCapabilities, remoteProducerId, serverConsumerTransportId },
      callback,
    ) => {
      try {
        const { roomName } = peers[socket.id];
        const router = rooms[roomName].router;
        let consumerTransport = transports.find(
          (transportData) =>
            transportData.consumer &&
            transportData.transport.id == serverConsumerTransportId,
        ).transport;

        // check if the router can consume the specified producer
        if (
          router.canConsume({
            producerId: remoteProducerId,
            rtpCapabilities,
          })
        ) {
          // transport can now consume and return a consumer
          console.log(consumerTransport, "the consumersrslfdslfs");
          const consumer = await consumerTransport.consume({
            producerId: remoteProducerId,
            rtpCapabilities,
            paused: true,
          });

          consumer.on("transportclose", () => {
            console.log("transport close from consumer");
          });

          consumer.on("producerclose", () => {
            console.log("producer of consumer closed");
            socket.emit("producer-closed", { remoteProducerId });

            consumerTransport.close([]);
            transports = transports.filter(
              (transportData) =>
                transportData.transport.id !== consumerTransport.id,
            );
            consumer.close();
            consumer = consumers.filter(
              (consumerData) => consumerData.consumer.id !== consumer.id,
            );
          });
          addConsumer(consumer, roomName);

          // from the sonsumer extract the follwign params
          // to send back to the Client
          const params = {
            id: consumer.id,
            producerId: remoteProducerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
            serverConsumerId: consumer.id,
          };

          console.log(params, "the params seding to callback");
          // send the parameters to the client
          callback({ params });
        }
      } catch (err) {
        console.log(err, "coming from the cosume.on");
        callback({
          params: {
            error: err,
          },
        });
      }
    },
  );

  socket.on("consumer-resume", async ({ serverConsumerId }) => {
    console.log("consumer resume", socket.id);
    const { consumer } = consumers.find(
      (consumerData) => consumerData.consumer.id === serverConsumerId,
    );
    await consumer.resume();
  });

  socket.on("disconnect", () => {
    // do some cleanup
    console.log("peer disconnected", socket.id);
    try {
      consumers = consumers.filter(
        (consumerData) => consumerData.socketId !== socket.id,
      );
      producers = producers.filter(
        (producerData) => producerData.socketId !== socket.id,
      );
      transports = transports.filter(
        (transportData) => transportData.socketId !== socket.id,
      );
      // consumers = removeItems(consumers, socket.id, "consumer");
      // producers = removeItems(producers, socket.id, "producer");
      // transports = removeItems(transports, socket.id, "transport");

      const { roomName } = peers[socket.id];
      delete peers[socket.id];

      // remove socket from room
      rooms[roomName] = {
        router: rooms[roomName].router,
        peers: rooms[roomName].peers.filter(
          (socketId) => socket.id !== socketId,
        ),
      };
    } catch (err) {
      console.log(err);
    }
  });
});
