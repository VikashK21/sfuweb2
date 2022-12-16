import React, { useEffect, useRef, useState } from "react";
// eslint-disable-next-line
import mediasoupClient from "mediasoup-client";

function RemoteStream({ videoStyle, frameStyle, params, consumer, bringToW }) {
  const remoteVideo = useRef();
  const remoteAudio = useRef();
  const [mic, setMic] = useState(false);
  const [allow, setAllow] = useState(false);

  const run = () => {
    console.log(consumer, "after onChange triggered....");
    // eslint-disable-next-line
    // bringToW(params, consumer, true);
  };

  useEffect(() => {
    const { track } = consumer;
    console.log(track, "the remote video from the RemoteStream");
    if (params.kind === "audio") {
      remoteAudio.current.srcObject = new MediaStream([track]);
      console.log(track, "the remote audio from the RemoteStream");
      // const stream = remoteAudio.current.srcObject
      //   .getTracks()
      //   .filter((track) => track.kind === "audio");
      // setMic((pre) => {
      //   if (stream) return !pre;
      // });
      setAllow(true);
    }
    remoteVideo.current.srcObject = new MediaStream([track]);
    run();
    // eslint-disable-next-line
  }, [consumer, params]);
  return (
    <div
      style={
        allow
          ? {
              width: 1,
              // borderColor: "orange 2px solid",
              float: "left",
              backgroundColor: "orange",
            }
          : frameStyle
      }
    >
      <audio ref={remoteAudio}></audio>
      {/* <i
        style={{
          padding: 1,
          fontSize: 20,
          color: (mic && "white") || "red",
        }}
        class="material-icons"
      >
        {(mic && "mic") || "mic_off"}
      </i> */}
      <video
        // onChange={() => {
        //   console.log(consumer, "after onChange triggered....");
        //   bringToW(params, consumer, true);
        // }}
        onClick={() => {
          console.log(consumer, "after onClick triggered....");
          bringToW(params, consumer);
        }}
        style={videoStyle}
        ref={remoteVideo}
        autoPlay
      ></video>
    </div>
  );
}

export default RemoteStream;
