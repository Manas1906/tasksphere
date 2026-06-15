import { socket } from './websocket';

/**
 * VoiceCallController manages the WebRTC peer-to-peer audio and video calling lifecycle.
 * Signaling is sent over the STOMP/WebSocket connection.
 */
export class VoiceCallController {
  constructor() {
    this.state = 'IDLE'; // IDLE | OUTGOING_RING | INCOMING_RING | CONNECTED | ENDED
    this.peerConnection = null;
    this.localStream = null;
    this.remoteAudio = null;
    this.callPartner = null;
    this.callPartnerAvatar = null;
    this.isMuted = false;
    this.isVideoEnabled = false;
    this.isScreenSharing = false;
    this.callTimerInterval = null;
    this.callStartTime = null;
    this.isCaller = false;
    this._popoverOutsideClickListener = null;
    this._originalVideoTrack = null;
    this._screenStream = null;

    // ICE servers for NAT traversal — STUN + free public TURN fallback
    this.iceConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        // Free public TURN relay (OpenRelay Project) for cross-NAT connections
        {
          urls: 'turn:openrelay.metered.ca:80',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        },
        {
          urls: 'turn:openrelay.metered.ca:443',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        },
        {
          urls: 'turn:openrelay.metered.ca:443?transport=tcp',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        }
      ]
    };

    console.log('[VOICECALL] Controller initialized.');
  }

  get myUsername() {
    return localStorage.getItem('chat_username') || 'Guest';
  }

  get myAvatar() {
    return localStorage.getItem('chat_avatar') || `https://api.dicebear.com/7.x/bottts/svg?seed=${this.myUsername}`;
  }

  isFeatureEnabled() {
    return window.__featureToggles && window.__featureToggles.voice_calling === true;
  }

  /**
   * Process signaling signals from the WebSocket topic
   */
  handleSignal(payload) {
    switch (payload.type) {
      case 'offer':
        this.handleIncomingOffer(payload);
        break;
      case 'answer':
        this.handleIncomingAnswer(payload);
        break;
      case 'ice':
        this.handleIncomingIce(payload);
        break;
      case 'hangup':
        this.handleRemoteHangup(payload);
        break;
      default:
        console.warn('[VOICECALL] Unknown signal type:', payload.type);
    }
  }

  /**
   * Save a call log message into the DM history (caller only)
   */
  saveCallLog(logMessage) {
    if (!this.isCaller || !this.callPartner) return;
    
    socket.send('/app/chat.send', {
      username: this.myUsername,
      avatarUrl: this.myAvatar,
      message: `[DM:${this.callPartner}] 📞 ${logMessage}`
    });
  }

  // --- Outgoing Call flow ---
 
  async initiateCall(targetUsername, targetAvatar, callType = 'VOICE') {
    if (!this.isFeatureEnabled()) {
      console.warn('[VOICECALL] Calling features are disabled.');
      return;
    }

    if (this.state !== 'IDLE') {
      console.warn('[VOICECALL] Cannot call, active state is:', this.state);
      return;
    }

    console.log(`[VOICECALL] Dialing ${targetUsername} via ${callType}...`);
    this.callPartner = targetUsername;
    this.callPartnerAvatar = targetAvatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${targetUsername}`;
    this.state = 'OUTGOING_RING';
    this.isCaller = true;
    this.callType = callType;

    // Show Outgoing UI and start ringtone immediately for zero visual latency
    this.showOutgoingCallUI();
    this.startOutgoingRing();

    // 30 seconds ringback timeout
    this._ringTimeout = setTimeout(() => {
      if (this.state === 'OUTGOING_RING') {
        console.log('[VOICECALL] Call timed out.');
        this.saveCallLog(`Missed ${this.callType.toLowerCase()} call`);
        this.hangUp();
      }
    }, 30000);

    try {
      // Request media stream based on call type
      if (callType === 'VIDEO') {
        try {
          this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
          this.isVideoEnabled = true;
        } catch (videoErr) {
          console.warn('[VOICECALL] Camera unavailable, falling back to audio only:', videoErr);
          this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          this.isVideoEnabled = false;
          this.callType = 'VOICE';
        }
      } else {
        // Voice Call: only request audio to avoid slow camera spin up
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        this.isVideoEnabled = false;
      }

      this.createPeerConnection();

      this.localStream.getTracks().forEach(track => {
        this.peerConnection.addTrack(track, this.localStream);
      });

      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      socket.send('/app/call.offer', {
        type: 'offer',
        caller: this.myUsername,
        callerAvatar: this.myAvatar,
        callerTimestamp: Date.now().toString(),
        target: targetUsername,
        sdp: offer.sdp,
        callType: this.callType
      });

    } catch (err) {
      console.error('[VOICECALL] Call failed to initialize:', err);
      this.state = 'IDLE';
      this.cleanup();

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        alert('Microphone/Camera access is required to make calls.');
      } else {
        alert('Could not start call: ' + (err.message || err));
      }
    }
  }

  // --- Incoming Call flow ---

  async handleIncomingOffer(payload) {
    if (this.state !== 'IDLE') {
      socket.send('/app/call.hangup', {
        type: 'hangup',
        caller: this.myUsername,
        target: payload.caller,
        reason: 'busy'
      });
      return;
    }

    console.log(`[VOICECALL] Incoming call from ${payload.caller} (${payload.callType})`);
    this.callPartner = payload.caller;
    this.callPartnerAvatar = payload.callerAvatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${payload.caller}`;
    this.state = 'INCOMING_RING';
    this.isCaller = false;
    this.callType = payload.callType || 'VOICE';
    this._pendingOffer = payload;

    // Show Incoming UI and play ringtone immediately for zero visual latency
    this.showIncomingCallUI();
    this.startIncomingRing();
  }

  async acceptCall() {
    if (this.state !== 'INCOMING_RING' || !this._pendingOffer) return;

    // Show connecting status or overlay update if needed
    console.log('[VOICECALL] Accepting call...');

    try {
      if (this.callType === 'VIDEO') {
        try {
          this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
          this.isVideoEnabled = true;
        } catch (videoErr) {
          console.warn('[VOICECALL] Camera unavailable, accepting with audio only:', videoErr);
          this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          this.isVideoEnabled = false;
          this.callType = 'VOICE';
        }
      } else {
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        this.isVideoEnabled = false;
      }

      this.createPeerConnection();

      this.localStream.getTracks().forEach(track => {
        this.peerConnection.addTrack(track, this.localStream);
      });

      await this.peerConnection.setRemoteDescription(
        new RTCSessionDescription({ type: 'offer', sdp: this._pendingOffer.sdp })
      );

      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      socket.send('/app/call.answer', {
        type: 'answer',
        caller: this.myUsername,
        target: this.callPartner,
        sdp: answer.sdp
      });

      if (this._pendingIceCandidates) {
        for (const candidate of this._pendingIceCandidates) {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
        this._pendingIceCandidates = [];
      }

      this._pendingOffer = null;
      this.state = 'CONNECTED';
      this.onCallConnected();

    } catch (err) {
      console.error('[VOICECALL] Could not accept call:', err);
      this.hangUp();
    }
  }

  declineCall() {
    if (this.state !== 'INCOMING_RING') return;

    socket.send('/app/call.hangup', {
      type: 'hangup',
      caller: this.myUsername,
      target: this.callPartner,
      reason: 'declined'
    });

    this._pendingOffer = null;
    this.state = 'IDLE';
    this.hideIncomingCallUI();
    this.cleanup();
  }

  // --- Signaling Handlers ---

  async handleIncomingAnswer(payload) {
    if (this.state !== 'OUTGOING_RING') return;

    try {
      await this.peerConnection.setRemoteDescription(
        new RTCSessionDescription({ type: 'answer', sdp: payload.sdp })
      );

      if (this._pendingIceCandidates) {
        for (const candidate of this._pendingIceCandidates) {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
        this._pendingIceCandidates = [];
      }

      if (this._ringTimeout) {
        clearTimeout(this._ringTimeout);
        this._ringTimeout = null;
      }

      this.state = 'CONNECTED';
      this.onCallConnected();

    } catch (err) {
      console.error('[VOICECALL] Error processing answer:', err);
      this.hangUp();
    }
  }

  async handleIncomingIce(payload) {
    if (!payload.candidate) return;

    try {
      if (this.peerConnection && this.peerConnection.remoteDescription) {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate));
      } else {
        if (!this._pendingIceCandidates) this._pendingIceCandidates = [];
        this._pendingIceCandidates.push(payload.candidate);
      }
    } catch (err) {
      console.warn('[VOICECALL] Error adding ICE candidate:', err);
    }
  }

  handleRemoteHangup(payload) {
    if (this.state === 'OUTGOING_RING') {
      if (payload.reason === 'busy') {
        this.saveCallLog('User is busy');
        if (window.app) {
          window.app.showNotificationToast('📞 Call Failed', `${this.callPartner} is busy.`, 'UNASSIGNMENT');
        }
      } else if (payload.reason === 'declined') {
        this.saveCallLog('Declined voice call');
        if (window.app) {
          window.app.showNotificationToast('📞 Call Declined', `${this.callPartner} declined.`, 'UNASSIGNMENT');
        }
      } else {
        this.saveCallLog('Missed voice call');
      }
    }
    
    this.endCall();
  }

  // --- RTCPeerConnection Setup ---

  createPeerConnection() {
    this.peerConnection = new RTCPeerConnection(this.iceConfig);

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.send('/app/call.ice', {
          type: 'ice',
          caller: this.myUsername,
          target: this.callPartner,
          candidate: event.candidate.toJSON()
        });
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection.connectionState;
      if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        if (this.state === 'CONNECTED') {
          this.endCall();
        }
      }
    };

    this.peerConnection.ontrack = (event) => {
      const remoteVideo = document.getElementById('remoteVideo');
      if (remoteVideo && event.streams[0]) {
        remoteVideo.srcObject = event.streams[0];
      }
      
      this.remoteAudio = document.getElementById('remoteAudio');
      if (this.remoteAudio && event.streams[0]) {
        this.remoteAudio.srcObject = event.streams[0];
      }

      this.updateCallLayout();
    };
  }

  // --- Call Controls ---

  toggleMute() {
    if (!this.localStream) return;

    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      this.isMuted = !this.isMuted;
      audioTrack.enabled = !this.isMuted;
      this.updateMuteUI();
    }
  }

  async toggleVideo() {
    if (!this.localStream) return;

    let videoTrack = this.localStream.getVideoTracks()[0];
    if (!videoTrack) {
      // Upgrading Voice Call to Video Call
      try {
        console.log('[VOICECALL] Requesting camera for voice-to-video call upgrade...');
        const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
        videoTrack = videoStream.getVideoTracks()[0];
        
        if (videoTrack) {
          this.localStream.addTrack(videoTrack);
          this.isVideoEnabled = true;
          this.callType = 'VIDEO';
          
          if (this.peerConnection) {
            this.peerConnection.addTrack(videoTrack, this.localStream);
            
            // Renegotiate Peer Connection offer
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);
            
            socket.send('/app/call.offer', {
              type: 'offer',
              caller: this.myUsername,
              callerAvatar: this.myAvatar,
              target: this.callPartner,
              sdp: offer.sdp,
              callType: 'VIDEO'
            });
          }
        }
      } catch (err) {
        console.error('[VOICECALL] Upgrade to video failed:', err);
        alert('Could not enable camera: ' + (err.message || err));
        return;
      }
    } else {
      this.isVideoEnabled = !this.isVideoEnabled;
      videoTrack.enabled = this.isVideoEnabled;
    }

    const localVideo = document.getElementById('localVideo');
    if (localVideo && this.localStream && !localVideo.srcObject) {
      localVideo.srcObject = this.localStream;
    }

    this.updateCallLayout();
  }

  async toggleScreenShare() {
    if (!this.peerConnection) return;

    if (this.isScreenSharing) {
      await this.stopScreenShare();
    } else {
      await this.startScreenShare();
    }
  }

  async startScreenShare() {
    try {
      console.log('[VOICECALL] Initiating screen share...');
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = screenStream.getVideoTracks()[0];

      const senders = this.peerConnection.getSenders();
      const videoSender = senders.find(s => s.track && s.track.kind === 'video');

      if (videoSender) {
        await videoSender.replaceTrack(screenTrack);
      }

      const localVideo = document.getElementById('localVideo');
      if (localVideo) {
        localVideo.srcObject = screenStream;
      }

      this._originalVideoTrack = this.localStream.getVideoTracks()[0];
      this._screenStream = screenStream;
      this.isScreenSharing = true;

      const btn = document.getElementById('screenShareBtn');
      if (btn) {
        btn.classList.add('active');
        btn.textContent = '🛑 Screen';
        btn.title = 'Stop Screen Sharing';
      }

      screenTrack.onended = () => this.stopScreenShare();

    } catch (err) {
      console.error('[VOICECALL] Screen share failed:', err);
    }
  }

  async stopScreenShare() {
    if (!this.isScreenSharing) return;

    console.log('[VOICECALL] Stopping screen share...');
    if (this._screenStream) {
      this._screenStream.getTracks().forEach(track => track.stop());
    }

    try {
      let cameraTrack = this._originalVideoTrack;
      if (!cameraTrack || cameraTrack.readyState === 'ended') {
        const camStream = await navigator.mediaDevices.getUserMedia({ video: true });
        cameraTrack = camStream.getVideoTracks()[0];
        const oldTrack = this.localStream.getVideoTracks()[0];
        if (oldTrack) this.localStream.removeTrack(oldTrack);
        this.localStream.addTrack(cameraTrack);
      }

      const senders = this.peerConnection.getSenders();
      const videoSender = senders.find(s => s.track && s.track.kind === 'video');

      if (videoSender && cameraTrack) {
        await videoSender.replaceTrack(cameraTrack);
      }

      const localVideo = document.getElementById('localVideo');
      if (localVideo) {
        localVideo.srcObject = this.localStream;
      }

      this.isScreenSharing = false;
      this._screenStream = null;

      const btn = document.getElementById('screenShareBtn');
      if (btn) {
        btn.classList.remove('active');
        btn.textContent = '🖥️ Screen';
        btn.title = 'Share Screen';
      }

    } catch (err) {
      console.error('[VOICECALL] Failed to restore camera track:', err);
    }
  }

  hangUp() {
    if (this.state === 'OUTGOING_RING') {
      this.saveCallLog('Missed voice call');
    }

    if (this.callPartner) {
      socket.send('/app/call.hangup', {
        type: 'hangup',
        caller: this.myUsername,
        target: this.callPartner,
        reason: 'normal'
      });
    }

    this.endCall();
  }

  endCall() {
    if (this._ringTimeout) {
      clearTimeout(this._ringTimeout);
      this._ringTimeout = null;
    }

    if (this.state === 'CONNECTED' && this.callStartTime) {
      const elapsed = Math.floor((Date.now() - this.callStartTime) / 1000);
      const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const secs = String(elapsed % 60).padStart(2, '0');
      this.saveCallLog(`Voice call ended • ${mins}:${secs}`);
    }

    this.state = 'IDLE';
    this.hideIncomingCallUI();
    this.hideActiveCallUI();
    this.hideOutgoingCallUI();
    this.cleanup();
  }

  // --- Tone Synthesizers for Calling ---

  startOutgoingRing() {
    this.stopRinging();
    try {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      
      const playRingCycle = () => {
        if (this.state !== 'OUTGOING_RING') return;
        const now = this.audioCtx.currentTime;
        
        const osc1 = this.audioCtx.createOscillator();
        const osc2 = this.audioCtx.createOscillator();
        const gainNode = this.audioCtx.createGain();
        
        osc1.frequency.setValueAtTime(440, now);
        osc2.frequency.setValueAtTime(480, now);
        
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(0.08, now + 0.1);
        gainNode.gain.setValueAtTime(0.08, now + 1.9);
        gainNode.gain.linearRampToValueAtTime(0, now + 2.0);
        
        osc1.connect(gainNode);
        osc2.connect(gainNode);
        gainNode.connect(this.audioCtx.destination);
        
        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 2.0);
        osc2.stop(now + 2.0);
      };
      
      playRingCycle();
      this.ringInterval = setInterval(playRingCycle, 5000);
    } catch (e) {
      console.warn('[VOICECALL] Outgoing ring sound failed:', e);
    }
  }

  startIncomingRing() {
    this.stopRinging();
    try {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      
      const playMelodyCycle = () => {
        if (this.state !== 'INCOMING_RING') return;
        const now = this.audioCtx.currentTime;
        
        const melody = [
          { freq: 659.25, time: 0.0, dur: 0.12 },
          { freq: 880.00, time: 0.12, dur: 0.12 },
          { freq: 987.77, time: 0.24, dur: 0.12 },
          { freq: 1318.51, time: 0.36, dur: 0.35 },
          { freq: 987.77, time: 0.8, dur: 0.12 },
          { freq: 1318.51, time: 0.92, dur: 0.35 }
        ];
        
        melody.forEach(note => {
          const osc = this.audioCtx.createOscillator();
          const gainNode = this.audioCtx.createGain();
          
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(note.freq, now + note.time);
          
          gainNode.gain.setValueAtTime(0, now + note.time);
          gainNode.gain.linearRampToValueAtTime(0.12, now + note.time + 0.02);
          gainNode.gain.exponentialRampToValueAtTime(0.001, now + note.time + note.dur);
          
          osc.connect(gainNode);
          gainNode.connect(this.audioCtx.destination);
          
          osc.start(now + note.time);
          osc.stop(now + note.time + note.dur);
        });
      };
      
      playMelodyCycle();
      this.ringInterval = setInterval(playMelodyCycle, 2000);
    } catch (e) {
      console.warn('[VOICECALL] Incoming ring sound failed:', e);
    }
  }

  stopRinging() {
    if (this.ringInterval) {
      clearInterval(this.ringInterval);
      this.ringInterval = null;
    }
    if (this.audioCtx) {
      try {
        if (this.audioCtx.state !== 'closed') {
          this.audioCtx.close();
        }
      } catch (e) {}
      this.audioCtx = null;
    }
  }

  cleanup() {
    this.stopRinging();

    const popover = document.getElementById('callDevicePopover');
    if (popover) {
      popover.classList.add('hidden');
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    if (this._screenStream) {
      this._screenStream.getTracks().forEach(track => track.stop());
      this._screenStream = null;
    }

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    if (this.remoteAudio) {
      this.remoteAudio.srcObject = null;
    }

    if (this.callTimerInterval) {
      clearInterval(this.callTimerInterval);
      this.callTimerInterval = null;
    }

    this.callPartner = null;
    this.callPartnerAvatar = null;
    this.isMuted = false;
    this.isVideoEnabled = false;
    this.isScreenSharing = false;
    this.callStartTime = null;
    this._pendingOffer = null;
    this._pendingIceCandidates = [];
    this._originalVideoTrack = null;
    this.state = 'IDLE';
  }

  onCallConnected() {
    this.stopRinging();
    this.callStartTime = Date.now();
    this.hideIncomingCallUI();
    this.hideOutgoingCallUI();
    this.showActiveCallUI();

    // Bind local video stream to local view box
    const localVideo = document.getElementById('localVideo');
    if (localVideo && this.localStream) {
      localVideo.srcObject = this.localStream;
    }

    // Bind remote video stream dynamically if tracks are already active
    if (this.peerConnection) {
      const remoteVideo = document.getElementById('remoteVideo');
      const receivers = this.peerConnection.getReceivers();
      const remoteStream = receivers.length > 0 ? new MediaStream(receivers.map(r => r.track)) : null;
      if (remoteVideo && remoteStream) {
        remoteVideo.srcObject = remoteStream;
      }
    }
  }

  // --- Audio Device Management ---

  async toggleDevicePopover() {
    const popover = document.getElementById('callDevicePopover');
    if (!popover) return;
    
    const isHidden = popover.classList.contains('hidden');
    if (isHidden) {
      popover.classList.remove('hidden');
      await this.populateDeviceSelectors();
    } else {
      popover.classList.add('hidden');
    }
  }

  async populateDeviceSelectors() {
    const micSelect = document.getElementById('micSelect');
    const speakerSelect = document.getElementById('speakerSelect');
    if (!micSelect || !speakerSelect) return;
    
    micSelect.innerHTML = '';
    speakerSelect.innerHTML = '';
    
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      const audioOutputs = devices.filter(device => device.kind === 'audiooutput');
      
      audioInputs.forEach((device, idx) => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || `Microphone ${idx + 1}`;
        if (this.localStream) {
          const currentTrack = this.localStream.getAudioTracks()[0];
          if (currentTrack && currentTrack.getSettings().deviceId === device.deviceId) {
            option.selected = true;
          }
        }
        micSelect.appendChild(option);
      });
      
      audioOutputs.forEach((device, idx) => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || `Speaker ${idx + 1}`;
        if (this.remoteAudio && this.remoteAudio.sinkId === device.deviceId) {
          option.selected = true;
        }
        speakerSelect.appendChild(option);
      });
      
      micSelect.onchange = () => this.switchMicrophone(micSelect.value);
      speakerSelect.onchange = () => this.switchSpeaker(speakerSelect.value);
      
    } catch (err) {
      console.error('[VOICECALL] Error listing audio devices:', err);
    }
  }

  async switchMicrophone(deviceId) {
    if (!this.localStream) return;
    
    try {
      const currentTrack = this.localStream.getAudioTracks()[0];
      if (currentTrack) {
        currentTrack.stop();
      }
      
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } }
      });
      
      const newTrack = newStream.getAudioTracks()[0];
      
      if (this.peerConnection) {
        const senders = this.peerConnection.getSenders();
        const sender = senders.find(s => s.track && s.track.kind === 'audio');
        if (sender) {
          await sender.replaceTrack(newTrack);
        }
      }
      
      this.localStream = newStream;
      
    } catch (err) {
      console.error('[VOICECALL] Microphone switch failed:', err);
      alert('Failed to switch microphone.');
    }
  }

  async switchSpeaker(deviceId) {
    this.remoteAudio = document.getElementById('remoteAudio');
    if (!this.remoteAudio) return;
    
    if (typeof this.remoteAudio.setSinkId === 'function') {
      try {
        await this.remoteAudio.setSinkId(deviceId);
      } catch (err) {
        console.error('[VOICECALL] Speaker switch failed:', err);
        alert('Failed to switch speaker.');
      }
    } else {
      alert('Speaker switching is not supported by your browser.');
    }
  }

  // --- UI Overlay Helpers ---

  removeUIElement(id) {
    const el = document.getElementById(id);
    if (el) {
      el.classList.add('closing');
      setTimeout(() => el.remove(), 300);
    }
  }

  createCallOverlay(id, label, buttonsHtml, bindFn) {
    const overlay = document.createElement('div');
    overlay.id = id;
    overlay.className = 'incoming-call-overlay';
    overlay.innerHTML = `
      <div class="incoming-call__avatar-ring">
        <img class="incoming-call__avatar" src="${this.callPartnerAvatar}" alt="${this.callPartner}">
      </div>
      <span class="incoming-call__label">${label}</span>
      <span class="incoming-call__username">${this.callPartner}</span>
      <div class="incoming-call__actions">
        ${buttonsHtml}
      </div>
    `;
    document.body.appendChild(overlay);
    bindFn();
  }

  showIncomingCallUI() {
    this.hideIncomingCallUI();
    
    const buttons = `
      <button class="call-action-btn" id="acceptCallBtn">
        <span class="call-action-btn__circle call-action-btn__circle--accept">
          <svg viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
        </span>
        <span class="call-action-btn__label">Accept</span>
      </button>
      <button class="call-action-btn" id="declineCallBtn">
        <span class="call-action-btn__circle call-action-btn__circle--decline">
          <svg viewBox="0 0 24 24"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7s.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71s-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C14.15 9.25 12.6 9 12 9z"/></svg>
        </span>
        <span class="call-action-btn__label">Decline</span>
      </button>
    `;
    
    this.createCallOverlay('incomingCallOverlay', 'Incoming Call', buttons, () => {
      document.getElementById('acceptCallBtn').onclick = () => this.acceptCall();
      document.getElementById('declineCallBtn').onclick = () => this.declineCall();
    });
  }

  hideIncomingCallUI() {
    this.removeUIElement('incomingCallOverlay');
  }

  showOutgoingCallUI() {
    this.hideOutgoingCallUI();
    
    const buttons = `
      <button class="call-action-btn" id="cancelCallBtn">
        <span class="call-action-btn__circle call-action-btn__circle--decline">
          <svg viewBox="0 0 24 24"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7s.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71s-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C14.15 9.25 12.6 9 12 9z"/></svg>
        </span>
        <span class="call-action-btn__label">Cancel</span>
      </button>
    `;
    
    this.createCallOverlay('outgoingCallOverlay', 'Calling...', buttons, () => {
      document.getElementById('cancelCallBtn').onclick = () => this.hangUp();
    });
  }

  hideOutgoingCallUI() {
    this.removeUIElement('outgoingCallOverlay');
  }

  showActiveCallUI() {
    this.hideActiveCallUI();

    const overlay = document.createElement('div');
    overlay.id = 'activeCallOverlay';
    overlay.className = 'active-call-overlay';
    
    // Setup blurred background image of target user if available, fallback to dark blue gradient
    overlay.style.backgroundImage = `radial-gradient(circle at center, rgba(15, 23, 42, 0.85) 0%, #0b0e14 100%)`;

    overlay.innerHTML = `
      <div class="active-call__header">
        <span class="active-call__partner-name">${this.callPartner}</span>
        <span class="active-call__status" id="callStatusText">${this.callType === 'VIDEO' ? 'Video Call' : 'Voice Call'}</span>
        <span class="active-call__timer" id="callTimer">00:00</span>
      </div>
      
      <!-- Voice Call Centered Container -->
      <div class="active-call__voice-content">
        <div class="active-call__avatar-pulse">
          <img src="${this.callPartnerAvatar}" alt="${this.callPartner}" class="active-call__avatar">
        </div>
      </div>

      <!-- Video Call Grid Layout -->
      <div class="active-call__video-grid" id="activeCallVideoGrid" style="display: none;">
        <!-- Remote Stream (Full Screen background inside the overlay) -->
        <div class="active-call__video-box active-call__video-box--remote">
          <video id="remoteVideo" autoplay playsinline></video>
        </div>
        <!-- Local Stream (Small floating card in top-right) -->
        <div class="active-call__video-box active-call__video-box--local">
          <video id="localVideo" autoplay playsinline muted></video>
          <div class="active-call__local-label">You</div>
        </div>
      </div>

      <!-- Floating Glassmorphic Controls Pill -->
      <div class="active-call__controls-wrapper">
        <div class="active-call__controls">
          <button class="call-control-btn call-control-btn--mute" id="muteCallBtn" title="Mute Microphone">
            <svg viewBox="0 0 24 24"><path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/></svg>
          </button>
          <button class="call-control-btn" id="videoToggleBtn" title="Toggle Camera">
            <svg viewBox="0 0 24 24"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
          </button>
          <button class="call-control-btn" id="screenShareBtn" title="Share Screen">
            <svg viewBox="0 0 24 24"><path d="M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.11-.9-2-2-2H4c-1.11 0-2 .89-2 2v10c0 1.1.89 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/></svg>
          </button>
          <button class="call-control-btn call-control-btn--settings" id="deviceSettingsBtn" title="Device Settings">
            <svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
          </button>
          <button class="call-control-btn call-control-btn--hangup" id="hangupCallBtn" title="End Call">
            <svg viewBox="0 0 24 24"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7s.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71s-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C14.15 9.25 12.6 9 12 9z"/></svg>
          </button>
        </div>
        
        <div class="call-device-popover hidden" id="callDevicePopover">
          <div class="call-device-popover__title">Audio Settings</div>
          <div class="call-device-popover__group">
            <label for="micSelect">Microphone</label>
            <select id="micSelect" class="call-device-popover__select"></select>
          </div>
          <div class="call-device-popover__group">
            <label for="speakerSelect">Speaker</label>
            <select id="speakerSelect" class="call-device-popover__select"></select>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('muteCallBtn').onclick = () => this.toggleMute();
    document.getElementById('videoToggleBtn').onclick = () => this.toggleVideo();
    document.getElementById('screenShareBtn').onclick = () => this.toggleScreenShare();
    document.getElementById('deviceSettingsBtn').onclick = (e) => {
      e.stopPropagation();
      this.toggleDevicePopover();
    };
    document.getElementById('hangupCallBtn').onclick = () => this.hangUp();

    this._popoverOutsideClickListener = (e) => {
      const popover = document.getElementById('callDevicePopover');
      const settingsBtn = document.getElementById('deviceSettingsBtn');
      if (popover && !popover.classList.contains('hidden')) {
        if (!popover.contains(e.target) && settingsBtn && !settingsBtn.contains(e.target)) {
          popover.classList.add('hidden');
        }
      }
    };
    document.addEventListener('click', this._popoverOutsideClickListener);

    this.callTimerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.callStartTime) / 1000);
      const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const secs = String(elapsed % 60).padStart(2, '0');
      const timerEl = document.getElementById('callTimer');
      if (timerEl) timerEl.textContent = `${mins}:${secs}`;
    }, 1000);

    this.updateCallLayout();
  }

  hideActiveCallUI() {
    this.removeUIElement('activeCallOverlay');

    if (this.callTimerInterval) {
      clearInterval(this.callTimerInterval);
      this.callTimerInterval = null;
    }

    if (this._popoverOutsideClickListener) {
      document.removeEventListener('click', this._popoverOutsideClickListener);
      this._popoverOutsideClickListener = null;
    }
  }

  updateCallLayout() {
    const overlay = document.getElementById('activeCallOverlay');
    if (!overlay) return;

    const voiceContent = overlay.querySelector('.active-call__voice-content');
    const videoGrid = overlay.querySelector('.active-call__video-grid');
    const statusText = document.getElementById('callStatusText');

    const isVideoActive = this.isVideoEnabled || this.isScreenSharing;
    const hasRemoteVideo = this.peerConnection && 
      this.peerConnection.getReceivers().some(r => r.track && r.track.kind === 'video' && r.track.enabled);

    // Show video layout if either user has active video feed
    if (isVideoActive || hasRemoteVideo) {
      if (voiceContent) voiceContent.style.display = 'none';
      if (videoGrid) videoGrid.style.display = 'block';
      if (statusText) statusText.textContent = this.isScreenSharing ? 'Sharing Screen' : 'Video Call';

      const camBtn = document.getElementById('videoToggleBtn');
      if (camBtn) {
        camBtn.classList.toggle('muted', !this.isVideoEnabled);
        camBtn.title = this.isVideoEnabled ? 'Turn Camera Off' : 'Turn Camera On';
      }

      // Hide local card if camera is disabled and not screen sharing
      const localCard = overlay.querySelector('.active-call__video-box--local');
      if (localCard) {
        localCard.style.display = isVideoActive ? 'block' : 'none';
      }
    } else {
      if (voiceContent) voiceContent.style.display = 'flex';
      if (videoGrid) videoGrid.style.display = 'none';
      if (statusText) statusText.textContent = 'Voice Call';

      const camBtn = document.getElementById('videoToggleBtn');
      if (camBtn) {
        camBtn.classList.add('muted');
        camBtn.title = 'Turn Camera On';
      }
    }

    this.updateMuteUI();
  }

  updateMuteUI() {
    const muteBtn = document.getElementById('muteCallBtn');
    if (muteBtn) {
      muteBtn.classList.toggle('muted', this.isMuted);
      muteBtn.title = this.isMuted ? 'Unmute microphone' : 'Mute microphone';
    }
  }
}
