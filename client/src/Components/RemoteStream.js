import React, { useEffect, useRef, useState } from "react";
import mediasoupClient from "mediasoup-client";

function RemoteStream({muted, remoteAudio, videoStyle, frameStyle, params, consumer }) {
  const remoteVideo = useRef();
  const [allow, setAllow] = useState(false);

  useEffect(() => {
    if (params.kind === "audio") {
      setAllow(true);
    }
    const { track } = consumer;
    console.log(track, "the remote video from the RemoteStream");
    remoteVideo.current.srcObject = new MediaStream([track]);
  }, [consumer, params]);
  return (
    <div
      style={
        allow
          ? {
              width: 1,
              borderColor: "orange 2px solid",
              float: "left",
              backgroundColor: "orange",
            }
          : frameStyle
      }
    >
      <audio muted={muted} ref={remoteAudio}></audio>
      <video
        onClick={() => {
          console.log(consumer, "after onClick triggered....");
        }}
        style={videoStyle}
        muted={muted}
        ref={remoteVideo}
        autoPlay
      ></video>
    </div>
  );
}

export default RemoteStream;
