import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import mediasoupClient, { Device } from "mediasoup-client";

import "./App.css";
import RemoteStream from "./Components/RemoteStream";

const roomName = window.location.pathname;
const url = "/mediasoup";
let params = {
  // mediasoup params
  encodings: [
    {
      rid: "r0",
      maxBitrate: 100000,
      scalabilityMode: "S1T3",
    },
    {
      rid: "r1",
      maxBitrate: 300000,
      scalabilityMode: "S1T3",
    },
    {
      rid: "r2",
      maxBitrate: 900000,
      scalabilityMode: "S1T3",
    },
  ],
  // https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerCodecOptions
  codecOptions: {
    videoGoogleStartBitrate: 1000,
  },
};

function App() {
  const localVideo = useRef();
  const socket = useRef();

  let audioParams = {};
  let videoParams = { params };
  const [remoteVideos, setRemoteVideos] = useState([]);
  // const [audioParams, setAudioParams] = useState({});
  // const [videoParams, setVideoParams] = useState({ params });
  let consumingTransports = [];
  let consumerTransports = [];
  let audioProducer;
  let videoProducer;
  let consumer;
  let producerTransport;
  let rtpCapabilities;
  let device;

  const connectRecvTransport = async (
    consumerTransport,
    remoteProducerId,
    serverConsumerTransportId,
  ) => {
    // for consumer, we need to tell the server first
    // to create a consumer based on the rtpCapabilities nad consume
    // if the router can cansume, it will send back a set of params as below
    await socket.current.emit(
      "consume",
      {
        rtpCapabilities: device.rtpCapabilities,
        remoteProducerId,
        serverConsumerTransportId,
      },
      async ({ params }) => {
        if (params.error) {
          console.log(
            "cannot consume the consumer, comming from the connectRecvTransport",
          );
          return;
        }

        console.log(`Consumer Params ${params}`);
        // then sonsume with the local sonsumer transport
        // with creates a consumer
        const consumer = await consumerTransport.consume({
          id: params.id,
          producerId: params.producerId,
          kind: params.kind,
          rtpParameters: params.rtpParameters,
        });

        consumerTransports.push({
          consumerTransport,
          serverConsumerTransportId: params.id,
          producerId: remoteProducerId,
          consumer,
        });

        // create a new dive element for the new consumer media....
        setRemoteVideos((pre) => {
          let allow = true;
          for (let see of pre) {
            if (see[0] === remoteProducerId) return (allow = false);
          }
          const video = (
            <RemoteStream
              frameStyle={{
                width: 120,
                borderColor: "orange 2px solid",
                float: "left",
                backgroundColor: "orange",
              }}
              videoStyle={{
                cursor: "pointer",
                objectFit: "cover",
                borderRadius: 3,
                width: "100%",
              }}
              params={params}
              consumer={consumer}
            />
          );

          if (allow) return [...pre, [remoteProducerId, video]];
          return [...pre];
        });
        socket.current.emit("consumer-resume", {
          serverConsumerId: params.serverConsumerId,
        });
      },
    );
  };

  const signalNewConsumerTransport = async (remoteProducerId) => {
    // check if we are already consuming the remoteProducerId
    if (
      consumingTransports.length > 0 &&
      consumingTransports.includes(remoteProducerId)
    )
      return;
    consumingTransports.push(remoteProducerId);

    await socket.current.emit(
      "createWebRtcTransport",
      { consumer: true },
      ({ params }) => {
        // The server sends back params needed
        // to create Send Transport on the client side
        if (params.error) {
          console.log(
            params.error,
            "coming from the signalNewConsmerTransport of createWebRtcTransport",
          );
          return;
        }
        console.log(`PARAMS.... ${params}`);

        let consumerTransport;
        try {
          consumerTransport = device.createRecvTransport(params);
        } catch (err) {
          console.log(err, "from the consumerTransport");
          return;
        }

        consumerTransport.on(
          "connect",
          async ({ dtlsParameters }, callback, errback) => {
            try {
              console.log(dtlsParameters, "from the connect dtlsParameters");
              // Signal local DTLS parameters to the server side transport
              // see server's socket.on('transport-recv-connect', ....)
              await socket.current.emit("transport-recv-connect", {
                dtlsParameters,
                serverConsumerTransportId: params.id,
              });

              // Tell the transport that parameters were transmitted.
              callback();
            } catch (err) {
              // Tell the transport that something went wrong
              console.log(err, "the consumerTransport-connect");
              errback(err);
            }
          },
        );
        connectRecvTransport(consumerTransport, remoteProducerId, params.id);
      },
    );
  };

  const getProducers = () => {
    socket.current.emit("getProducers", (producerIds) => {
      console.log(
        producerIds,
        "producerIds coming from server of the getProducers",
      );
      // for each of the producer create a consumer
      // producerIds.forEach(id => signalNewConsumerTransport(id))
      producerIds.forEach(signalNewConsumerTransport);
    });
  };

  const connectSendTransport = async () => {
    // we now call produce() to instruct the roducer transport
    // to send media to the Router
    // this action will trigger the 'connect' and 'produce' events above

    console.log(audioParams, "the connectSendTransport");
    console.log(videoParams, "the connectSendTransport");
    console.log(producerTransport, "the connectSendtransport vidoe");
    try {
      audioProducer = await producerTransport.produce(audioParams);
      videoProducer = await producerTransport.produce(videoParams);

      console.log("coming here");
      audioProducer.on("trackended", () => {
        console.log("audio track ended");

        // call audio track
      });

      console.log("coming here");

      audioProducer.on("transportclose", () => {
        console.log("audio transport ended");

        // close audio trackc
      });

      console.log("coming here");

      videoProducer.on("trackended", () => {
        console.log("video track ended");

        // close video track
      });

      console.log("coming here");

      videoProducer.on("transportclose", () => {
        console.log("video transport ended");

        // close video track
      });
    } catch (err) {
      console.log(err, "the error of the audioProducer or videoProducer");
    }
  };

  const createSendTransport = () => {
    socket.current.emit(
      "createWebRtcTransport",
      { consumer: false },
      ({ params }) => {
        // The server send back params needed
        // to create Send transport on the client side
        if (params.error) {
          console.log(
            params.error,
            "params error comming from the server side of createSendTransport",
          );
          return;
        }

        console.log(params, "params created from the webRtcTransport");

        // creates a new WebRTC Transport to send media
        // based on the server's producer transport params
        producerTransport = device.createSendTransport(params);

        //this event is raised when a first call to transport.producer() is made
        // see connectSendTransport() below
        producerTransport.on(
          "connect",
          async ({ dtlsParameters }, callback, errback) => {
            try {
              console.log(dtlsParameters, "the connect transport side");
              // Signal local DTLS parameters to the server side transport
              // see server's socket.on('transport-connect', ....)
              await socket.current.emit("transport-connect", {
                dtlsParameters,
              });

              // Tell the transport that parameters were transmitted.
              callback();
            } catch (err) {
              errback(err);
            }
          },
        );

        producerTransport.on(
          "produce",
          async (parameters, callback, errback) => {
            console.log(parameters);

            try {
              // tell the server to create a Producer
              // with the following parameters and produce
              // and expect back a server side producer id
              // see server's socket.on('transport-produce', ...)
              await socket.current.emit(
                "transport-produce",
                {
                  kind: parameters.kind,
                  rtpParameters: parameters.rtpParameters,
                  appData: parameters.appData,
                },
                ({ id, producersExist }) => {
                  // Tell the server that parameters were transmitted and provide it with the server side producer's id
                  callback({ id });

                  // if producers exist, then join room
                  if (producersExist) {
                    getProducers();
                  }
                },
              );
            } catch (err) {
              errback(err);
            }
          },
        );
        connectSendTransport();
      },
    );
  };

  const createDevice = async () => {
    try {
      device = new Device();
      // device = new mediasoupClient.Device();

      // Loads the device with RTP capabilities of the Router (server side)
      console.log(rtpCapabilities, "data set from join room");
      await device.load({
        routerRtpCapabilities: rtpCapabilities,
      });

      console.log("Device RTP Capabilities", device.rtpCapabilities);

      // once the device loads, create transport
      createSendTransport();
    } catch (err) {
      console.log(err);
      if (err.name === "UnsupportedError") {
        console.warn("browser not supported");
      }
    }
  };

  const joinRoom = () => {
    socket.current.emit("joinRoom", { roomName }, (data) => {
      console.log(`Router RTP Capabalities.... ${data.rtpCapabilities}`);
      // we asign to local variable and will be used when
      // loading the client Device (see createDevice above)
      console.log(
        data.rtpCapabilities,
        "data coming from the server of joinRoom",
      );
      rtpCapabilities = data.rtpCapabilities;
      // setRtpCapabilities(data);

      // Once we have rtpCapabilities from the Router, create Device
      createDevice();
    });
  };

  const streamSuccess = (stream) => {
    localVideo.current.srcObject = stream;

    audioParams = {
      ...audioParams,
      track: stream.getAudioTracks()[0],
    };
    videoParams = {
      ...videoParams,
      track: stream.getVideoTracks()[0],
    };

    joinRoom();
  };

  const getLocalStream = () => {
    navigator.mediaDevices
      .getUserMedia({
        audio: true,
        video: {
          width: {
            min: 640,
            max: 1920,
          },
          height: {
            min: 400,
            max: 1080,
          },
        },
      })
      .then(streamSuccess)
      .catch((err) => console.log(err.message));
  };
  useEffect(() => {
    socket.current = io.connect(url, {
      path: "/io/webrtc",
    });

    socket.current.on("connection-success", ({ socketId }) => {
      console.log(socketId, "say I am there....");
      // Calling the localStreaming properties...
      getLocalStream();
    });

    // server informs the client of a new producer just joined
    socket.current.on("new-producer", ({ producerId }) =>
      signalNewConsumerTransport(producerId),
    );

    socket.current.on("producer-closed", ({ remoteProducerId }) => {
      console.log(remoteProducerId, "the producer got closed");
      // server notification is recieved when a producer is closed
      // we need to close the client-side consumer and associated transport
      const producerToClose = consumerTransports.find(
        (transportData) => transportData.producerId === remoteProducerId,
      );
      producerToClose.consumerTransport.close();
      producerToClose.consumer.close();

      // remove the consumer transport from the list
      consumerTransports.push(
        ...consumerTransports.filter(
          (transportData) => transportData.producerId !== remoteProducerId,
        ),
      );
      // remove the video div element
      setRemoteVideos(
        remoteVideos.filter((videoData) => videoData[0] !== remoteProducerId),
      );
    });
  }, []);

  return (
    <div>
      <div
        style={{
          width: 200,
          float: "left",
          margin: 5,
          borderRadius: 5,
          backgroundColor: "black",
        }}
      >
        <video
          style={{ width: 200 }}
          ref={localVideo}
          muted={false}
          autoPlay
        ></video>
      </div>
      <div
        style={{
          zIndex: 3,
          position: "fixed",
          padding: "6px 3px",
          backgroundColor: "rgba(0,0,0,0.3)",
          maxHeight: 120,
          top: "auto",
          right: 10,
          left: 10,
          bottom: 10,
          overflowX: "scroll",
          whiteSpace: "nowrap",
        }}
      >
        {remoteVideos.length > 0 && remoteVideos.map((videoCre) => videoCre[1])}
      </div>
    </div>
  );
}

export default App;
