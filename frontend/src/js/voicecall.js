import { socket } from './websocket';

/**
 * VoiceCallController — WebRTC Peer-to-Peer Voice Calling Engine
 * 
 * Manages the full call lifecycle: IDLE → RINGING → CONNECTED → ENDED
 * Uses browser WebRTC APIs for zero-cost audio transport.
 * Signaling is handled through the existing WebSocket/STOMP infrastructure.
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
    this.callTimerInterval = null;
    this.callStartTime = null;
    this.isCaller = false;
    this._popoverOutsideClickListener = null;

    // ICE servers — free public STUN servers for NAT traversal
    this.iceConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ]
    };

    console.log('[VOICECALL] VoiceCallController initialized.');
  }

  get myUsername() {
    return localStorage.getItem('chat_username') || 'Guest';
  }

  get myAvatar() {
    return localStorage.getItem('chat_avatar') || `https://api.dicebear.com/7.x/bottts/svg?seed=${this.myUsername}`;
  }

  /**
   * Check if voice calling feature is enabled by admin
   */
  isFeatureEnabled() {
    return window.__featureToggles && window.__featureToggles.voice_calling === true;
  }

  /**
   * Handle incoming signaling messages from WebSocket
   */
  handleSignal(payload) {
    const type = payload.type;

    switch (type) {
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
        console.warn('[VOICECALL] Unknown signal type:', type);
    }
  }

  /**
   * Post direct message containing call log info on behalf of the caller
   */
  saveCallLog(logMessage) {
    if (!this.isCaller) return; // Only caller records DM call log to prevent duplicates
    if (!this.callPartner) return;
    
    const payload = {
      username: this.myUsername,
      avatarUrl: this.myAvatar,
      message: `[DM:${this.callPartner}] 📞 ${logMessage}`
    };
    
    console.log('[VOICECALL-LOG] Saving call log message to DM:', payload);
    socket.send('/app/chat.send', payload);
  }

  /* =========================================================================
     Outgoing Call Flow
     ========================================================================= */

  async initiateCall(targetUsername, targetAvatar) {
    if (!this.isFeatureEnabled()) {
      console.warn('[VOICECALL] Voice calling is disabled by admin.');
      return;
    }

    if (this.state !== 'IDLE') {
      console.warn('[VOICECALL] Cannot initiate call — already in state:', this.state);
      return;
    }

    console.log(`[VOICECALL] Initiating call to ${targetUsername}...`);
    this.callPartner = targetUsername;
    this.callPartnerAvatar = targetAvatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${targetUsername}`;
    this.state = 'OUTGOING_RING';
    this.isCaller = true;

    try {
      // Request microphone access
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('[VOICECALL] Microphone access granted.');

      // Create RTCPeerConnection
      this.createPeerConnection();

      // Add local audio tracks to the connection
      this.localStream.getTracks().forEach(track => {
        this.peerConnection.addTrack(track, this.localStream);
      });

      // Create SDP offer
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      // Send offer to target via WebSocket
      socket.send('/app/call.offer', {
        type: 'offer',
        caller: this.myUsername,
        callerAvatar: this.myAvatar,
        target: targetUsername,
        sdp: offer.sdp
      });

      console.log('[VOICECALL] SDP Offer sent to', targetUsername);
      this.startOutgoingRing();
      this.showOutgoingCallUI();

      // Auto-timeout after 30 seconds of no answer
      this._ringTimeout = setTimeout(() => {
        if (this.state === 'OUTGOING_RING') {
          console.log('[VOICECALL] Call timed out — no answer.');
          this.saveCallLog('Missed voice call');
          this.hangUp();
        }
      }, 30000);

    } catch (err) {
      console.error('[VOICECALL] Failed to initiate call:', err);
      this.state = 'IDLE';
      this.cleanup();

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        alert('Microphone access is required to make voice calls. Please allow microphone permission and try again.');
      } else {
        alert('Failed to start call: ' + (err.message || err));
      }
    }
  }

  /* =========================================================================
     Incoming Call Flow
     ========================================================================= */

  async handleIncomingOffer(payload) {
    if (this.state !== 'IDLE') {
      // Already in a call — send busy signal (hangup)
      socket.send('/app/call.hangup', {
        type: 'hangup',
        caller: this.myUsername,
        target: payload.caller,
        reason: 'busy'
      });
      return;
    }

    console.log(`[VOICECALL] Incoming call from ${payload.caller}`);
    this.callPartner = payload.caller;
    this.callPartnerAvatar = payload.callerAvatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${payload.caller}`;
    this.state = 'INCOMING_RING';
    this.isCaller = false;
    this._pendingOffer = payload;

    // Play incoming ringtone sound
    this.startIncomingRing();

    this.showIncomingCallUI();
  }

  async acceptCall() {
    if (this.state !== 'INCOMING_RING' || !this._pendingOffer) return;

    console.log('[VOICECALL] Accepting call from', this.callPartner);

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });

      this.createPeerConnection();

      this.localStream.getTracks().forEach(track => {
        this.peerConnection.addTrack(track, this.localStream);
      });

      // Set the remote offer
      await this.peerConnection.setRemoteDescription(
        new RTCSessionDescription({ type: 'offer', sdp: this._pendingOffer.sdp })
      );

      // Create and send answer
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      socket.send('/app/call.answer', {
        type: 'answer',
        caller: this.myUsername,
        target: this.callPartner,
        sdp: answer.sdp
      });

      // Flush any ICE candidates queued before remote description was set
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
      console.error('[VOICECALL] Failed to accept call:', err);
      this.hangUp();
    }
  }

  declineCall() {
    if (this.state !== 'INCOMING_RING') return;

    console.log('[VOICECALL] Declining call from', this.callPartner);

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

  /* =========================================================================
     Signal Handlers
     ========================================================================= */

  async handleIncomingAnswer(payload) {
    if (this.state !== 'OUTGOING_RING') return;

    console.log('[VOICECALL] Received SDP answer from', payload.caller);

    try {
      await this.peerConnection.setRemoteDescription(
        new RTCSessionDescription({ type: 'answer', sdp: payload.sdp })
      );

      // Flush queued ICE candidates
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
      console.error('[VOICECALL] Failed to process answer:', err);
      this.hangUp();
    }
  }

  async handleIncomingIce(payload) {
    if (!payload.candidate) return;

    try {
      if (this.peerConnection && this.peerConnection.remoteDescription) {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate));
      } else {
        // Queue ICE candidates until remote description is set
        if (!this._pendingIceCandidates) this._pendingIceCandidates = [];
        this._pendingIceCandidates.push(payload.candidate);
      }
    } catch (err) {
      console.warn('[VOICECALL] Failed to add ICE candidate:', err);
    }
  }

  handleRemoteHangup(payload) {
    console.log('[VOICECALL] Remote hangup from', payload.caller, '— reason:', payload.reason || 'normal');
    
    if (this.state === 'OUTGOING_RING') {
      if (payload.reason === 'busy') {
        this.saveCallLog('User is busy');
        if (window.app) {
          window.app.showNotificationToast('📞 Call Failed', `${this.callPartner} is busy on another call.`, 'UNASSIGNMENT');
        }
      } else if (payload.reason === 'declined') {
        this.saveCallLog('Declined voice call');
        if (window.app) {
          window.app.showNotificationToast('📞 Call Declined', `${this.callPartner} declined your call.`, 'UNASSIGNMENT');
        }
      } else {
        this.saveCallLog('Missed voice call');
      }
    }
    
    this.endCall();
  }

  /* =========================================================================
     RTCPeerConnection Setup
     ========================================================================= */

  createPeerConnection() {
    this.peerConnection = new RTCPeerConnection(this.iceConfig);

    // ICE candidate events — send to remote peer
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

    // Connection state monitoring
    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection.connectionState;
      console.log('[VOICECALL] Connection state:', state);

      if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        if (this.state === 'CONNECTED') {
          console.log('[VOICECALL] Connection lost — ending call.');
          this.endCall();
        }
      }
    };

    // Receive remote audio stream
    this.peerConnection.ontrack = (event) => {
      console.log('[VOICECALL] Remote audio track received.');
      this.remoteAudio = document.getElementById('remoteAudio');
      if (this.remoteAudio && event.streams[0]) {
        this.remoteAudio.srcObject = event.streams[0];
      }
    };
  }

  /* =========================================================================
     Call Controls
     ========================================================================= */

  toggleMute() {
    if (!this.localStream) return;

    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      this.isMuted = !this.isMuted;
      audioTrack.enabled = !this.isMuted;
      console.log('[VOICECALL] Mute toggled:', this.isMuted ? 'MUTED' : 'UNMUTED');
      this.updateMuteUI();
    }
  }

  hangUp() {
    console.log('[VOICECALL] Hanging up call with', this.callPartner);

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

  /* =========================================================================
     Audio Synthesis Ringback & Ringtone
     ========================================================================= */

  startOutgoingRing() {
    this.stopRinging();
    try {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      
      const playRingCycle = () => {
        if (this.state !== 'OUTGOING_RING') return;
        const now = this.audioCtx.currentTime;
        
        // Standard US dual-frequency ringback: 440Hz + 480Hz
        const osc1 = this.audioCtx.createOscillator();
        const osc2 = this.audioCtx.createOscillator();
        const gainNode = this.audioCtx.createGain();
        
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(440, now);
        
        osc2.type = 'sine';
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
      console.warn('[VOICECALL] Failed to play outgoing ring sound:', e);
    }
  }

  startIncomingRing() {
    this.stopRinging();
    try {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      
      const playMelodyCycle = () => {
        if (this.state !== 'INCOMING_RING') return;
        const now = this.audioCtx.currentTime;
        
        // Premium, futuristic pentatonic ascending arpeggio melody (Teams-like but distinct)
        // E5 (659.25), A5 (880.00), B5 (987.77), E6 (1318.51)
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
          
          osc.type = 'triangle'; // Warmer, bell-like tone
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
      console.warn('[VOICECALL] Failed to play incoming ring sound:', e);
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

    // Close settings popover
    const popover = document.getElementById('callDevicePopover');
    if (popover) {
      popover.classList.add('hidden');
    }

    // Stop local microphone tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    // Close peer connection
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    // Clear remote audio
    if (this.remoteAudio) {
      this.remoteAudio.srcObject = null;
    }

    // Stop timer
    if (this.callTimerInterval) {
      clearInterval(this.callTimerInterval);
      this.callTimerInterval = null;
    }

    this.callPartner = null;
    this.callPartnerAvatar = null;
    this.isMuted = false;
    this.callStartTime = null;
    this._pendingOffer = null;
    this._pendingIceCandidates = [];
  }

  /* =========================================================================
     Call Connected Handler
     ========================================================================= */

  onCallConnected() {
    console.log('[VOICECALL] ✅ Call connected with', this.callPartner);
    this.stopRinging();
    this.callStartTime = Date.now();
    this.hideIncomingCallUI();
    this.hideOutgoingCallUI();
    this.showActiveCallUI();
  }

  /* =========================================================================
     Audio Device Management
     ========================================================================= */

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
      
      audioInputs.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || `Microphone ${index + 1}`;
        if (this.localStream) {
          const currentTrack = this.localStream.getAudioTracks()[0];
          if (currentTrack && currentTrack.getSettings().deviceId === device.deviceId) {
            option.selected = true;
          }
        }
        micSelect.appendChild(option);
      });
      
      audioOutputs.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || `Speaker ${index + 1}`;
        if (this.remoteAudio && this.remoteAudio.sinkId === device.deviceId) {
          option.selected = true;
        }
        speakerSelect.appendChild(option);
      });
      
      micSelect.onchange = async () => {
        await this.switchMicrophone(micSelect.value);
      };
      
      speakerSelect.onchange = async () => {
        await this.switchSpeaker(speakerSelect.value);
      };
      
    } catch (err) {
      console.error('[VOICECALL] Failed to enumerate audio devices:', err);
    }
  }

  async switchMicrophone(deviceId) {
    if (!this.localStream) return;
    console.log('[VOICECALL] Switching microphone to device ID:', deviceId);
    
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
          console.log('[VOICECALL] WebRTC sender track successfully replaced.');
        }
      }
      
      this.localStream = newStream;
      
    } catch (err) {
      console.error('[VOICECALL] Failed to switch microphone:', err);
      alert('Failed to switch microphone: ' + (err.message || err));
    }
  }

  async switchSpeaker(deviceId) {
    this.remoteAudio = document.getElementById('remoteAudio');
    if (!this.remoteAudio) {
      console.warn('[VOICECALL] remoteAudio element not found.');
      return;
    }
    
    if (typeof this.remoteAudio.setSinkId === 'function') {
      try {
        console.log('[VOICECALL] Switching speaker/sinkId to:', deviceId);
        await this.remoteAudio.setSinkId(deviceId);
        console.log('[VOICECALL] Speaker sinkId successfully set.');
      } catch (err) {
        console.error('[VOICECALL] Failed to set sinkId on audio element:', err);
        alert('Failed to switch speaker: ' + (err.message || err));
      }
    } else {
      console.warn('[VOICECALL] setSinkId() is not supported in this browser.');
      alert('Speaker switching is not supported by your browser.');
    }
  }

  /* =========================================================================
     UI Rendering
     ========================================================================= */

  showIncomingCallUI() {
    // Remove any existing overlay
    this.hideIncomingCallUI();

    const container = document.getElementById('chatContainer');
    if (!container) return;

    const overlay = document.createElement('div');
    overlay.id = 'incomingCallOverlay';
    overlay.className = 'incoming-call-overlay';
    overlay.innerHTML = `
      <div class="incoming-call__avatar-ring">
        <img class="incoming-call__avatar" src="${this.callPartnerAvatar}" alt="${this.callPartner}">
      </div>
      <span class="incoming-call__label">Incoming Voice Call</span>
      <span class="incoming-call__username">${this.callPartner}</span>
      <div class="incoming-call__actions">
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
      </div>
    `;

    container.appendChild(overlay);

    // Bind button events
    document.getElementById('acceptCallBtn').onclick = () => this.acceptCall();
    document.getElementById('declineCallBtn').onclick = () => this.declineCall();
  }

  hideIncomingCallUI() {
    const overlay = document.getElementById('incomingCallOverlay');
    if (overlay) {
      overlay.classList.add('closing');
      setTimeout(() => overlay.remove(), 300);
    }
  }

  showOutgoingCallUI() {
    this.hideOutgoingCallUI();

    const container = document.getElementById('chatContainer');
    if (!container) return;

    const overlay = document.createElement('div');
    overlay.id = 'outgoingCallOverlay';
    overlay.className = 'incoming-call-overlay';
    overlay.innerHTML = `
      <div class="incoming-call__avatar-ring">
        <img class="incoming-call__avatar" src="${this.callPartnerAvatar}" alt="${this.callPartner}">
      </div>
      <span class="incoming-call__label">Calling...</span>
      <span class="incoming-call__username">${this.callPartner}</span>
      <div class="incoming-call__actions">
        <button class="call-action-btn" id="cancelCallBtn">
          <span class="call-action-btn__circle call-action-btn__circle--decline">
            <svg viewBox="0 0 24 24"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7s.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71s-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C14.15 9.25 12.6 9 12 9z"/></svg>
          </span>
          <span class="call-action-btn__label">Cancel</span>
        </button>
      </div>
    `;

    container.appendChild(overlay);

    document.getElementById('cancelCallBtn').onclick = () => this.hangUp();
  }

  hideOutgoingCallUI() {
    const overlay = document.getElementById('outgoingCallOverlay');
    if (overlay) {
      overlay.classList.add('closing');
      setTimeout(() => overlay.remove(), 300);
    }
  }

  showActiveCallUI() {
    this.hideActiveCallUI();

    const chatPanel = document.querySelector('#chatContainer .chat-panel');
    if (!chatPanel) return;

    // Override active-call-bar overflow property dynamically when showing popover
    const bar = document.createElement('div');
    bar.id = 'activeCallBar';
    bar.className = 'active-call-bar';
    bar.style.overflow = 'visible'; // Ensure settings popover doesn't clip
    bar.innerHTML = `
      <div class="active-call-bar__pulse"></div>
      <div class="active-call-bar__info">
        <span class="active-call-bar__partner">${this.callPartner}</span>
        <span class="active-call-bar__timer" id="callTimer">00:00</span>
      </div>
      <div class="active-call-bar__controls">
        <button class="call-control-btn call-control-btn--mute" id="muteCallBtn" title="Mute/Unmute">
          <svg viewBox="0 0 24 24"><path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/></svg>
        </button>
        <button class="call-control-btn call-control-btn--settings" id="deviceSettingsBtn" title="Audio Settings">
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
    `;

    // Insert after chat-panel-header
    const header = chatPanel.querySelector('.chat-panel-header');
    if (header && header.nextSibling) {
      chatPanel.insertBefore(bar, header.nextSibling);
    } else {
      chatPanel.appendChild(bar);
    }

    // Bind controls
    document.getElementById('muteCallBtn').onclick = () => this.toggleMute();
    document.getElementById('deviceSettingsBtn').onclick = (e) => {
      e.stopPropagation();
      this.toggleDevicePopover();
    };
    document.getElementById('hangupCallBtn').onclick = () => this.hangUp();

    // Bind document click to dismiss popover when clicking outside
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

    // Start call timer
    this.callTimerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.callStartTime) / 1000);
      const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const secs = String(elapsed % 60).padStart(2, '0');
      const timerEl = document.getElementById('callTimer');
      if (timerEl) timerEl.textContent = `${mins}:${secs}`;
    }, 1000);
  }

  hideActiveCallUI() {
    const bar = document.getElementById('activeCallBar');
    if (bar) {
      bar.classList.add('closing');
      setTimeout(() => bar.remove(), 300);
    }

    if (this.callTimerInterval) {
      clearInterval(this.callTimerInterval);
      this.callTimerInterval = null;
    }

    if (this._popoverOutsideClickListener) {
      document.removeEventListener('click', this._popoverOutsideClickListener);
      this._popoverOutsideClickListener = null;
    }
  }

  updateMuteUI() {
    const muteBtn = document.getElementById('muteCallBtn');
    if (muteBtn) {
      if (this.isMuted) {
        muteBtn.classList.add('muted');
        muteBtn.title = 'Unmute';
      } else {
        muteBtn.classList.remove('muted');
        muteBtn.title = 'Mute';
      }
    }
  }
}
