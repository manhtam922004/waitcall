// Biến toàn cục
var peer, localStream;
var isLobby = false;
var waitingPeers = [];
var lobbyConn = null;
var currentCall = null;
var userInfo = {};

document.addEventListener("DOMContentLoaded", function() {
  // Load danh sách các quốc gia khi trang được load
  loadCountries();

  // Khi người dùng thay đổi chọn quốc gia ở phần thông tin cá nhân
  document.getElementById('country').addEventListener('change', function(){
    updateProvinceField(this.value, 'provinceContainer', 'province', true);
  });
  // Tương tự cho phần Desired Country (không bắt buộc)
  document.getElementById('desiredCountry').addEventListener('change', function(){
    updateProvinceField(this.value, 'desiredProvinceContainer', 'desiredProvince', false);
  });

  // Hiển thị modal nhập thông tin khi load trang
  $('#userInfoModal').modal('show');

  document.getElementById('userInfoForm').addEventListener('submit', function(e) {
    e.preventDefault();
    // Lấy thông tin cá nhân từ form
    userInfo.gender = document.getElementById('gender').value;
    userInfo.age = parseInt(document.getElementById('age').value);
    userInfo.country = document.getElementById('country').value;
    userInfo.province = document.getElementById('province').value;
    // Lấy thông tin đối tượng cần ghép nối (nếu có)
    userInfo.desired = {
      gender: document.getElementById('desiredGender').value,
      ageMin: document.getElementById('desiredAgeMin').value ? parseInt(document.getElementById('desiredAgeMin').value) : null,
      ageMax: document.getElementById('desiredAgeMax').value ? parseInt(document.getElementById('desiredAgeMax').value) : null,
      country: document.getElementById('desiredCountry').value,
      province: document.getElementById('desiredProvince').value
    };
    // Lưu tạm thông tin vào localStorage (không dùng database)
    localStorage.setItem('peerUserInfo', JSON.stringify(userInfo));
    $('#userInfoModal').modal('hide');
    document.getElementById('callContainer').style.display = 'block';
    initPeerConnection();
  });

  document.getElementById('endCallBtn').addEventListener('click', function(){
    endCall();
  });
});

/* --- Phần load dữ liệu quốc gia & tỉnh/thành --- */
function loadCountries() {
  fetch('https://restcountries.com/v3.1/all')
    .then(response => response.json())
    .then(data => {
      let countries = data.map(c => c.name.common);
      countries.sort();
      let countrySelect = document.getElementById('country');
      let desiredCountrySelect = document.getElementById('desiredCountry');
      countries.forEach(country => {
        let option = document.createElement('option');
        option.value = country;
        option.text = country;
        countrySelect.appendChild(option);
        // Cho phần desired country
        let option2 = document.createElement('option');
        option2.value = country;
        option2.text = country;
        desiredCountrySelect.appendChild(option2);
      });
    })
    .catch(err => console.error("Error loading countries:", err));
}

/**
 * updateProvinceField: Cập nhật container (có id containerId) để hiển thị select (nếu có dữ liệu states) hoặc input (nếu không)
 * @param {string} country - tên quốc gia đã chọn
 * @param {string} containerId - id của container bao quanh field
 * @param {string} fieldId - id cho field province/state
 * @param {boolean} isRequired - có bắt buộc hay không (true: bắt buộc, false: không)
 */
function updateProvinceField(country, containerId, fieldId, isRequired = true) {
  let container = document.getElementById(containerId);
  // Gọi API countriesnow để lấy dữ liệu states
  fetch('https://countriesnow.space/api/v0.1/countries/states', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({country: country})
  })
  .then(response => response.json())
  .then(data => {
      if(data.error || !data.data.states || data.data.states.length === 0){
          // Nếu không có dữ liệu, hiển thị input text
          container.innerHTML = `<label for="${fieldId}">Province/State</label>
                                 <input type="text" id="${fieldId}" class="form-control" ${isRequired ? "required" : ""}>`;
      } else {
          // Nếu có dữ liệu states, tạo select
          let html = `<label for="${fieldId}">Province/State</label>
                      <select id="${fieldId}" class="form-control" ${isRequired ? "required" : ""}>
                        <option value="">Select</option>`;
          data.data.states.forEach(state => {
              html += `<option value="${state.name}">${state.name}</option>`;
          });
          html += `</select>`;
          container.innerHTML = html;
      }
  })
  .catch(err => {
      console.error("Error fetching states", err);
      container.innerHTML = `<label for="${fieldId}">Province/State</label>
                             <input type="text" id="${fieldId}" class="form-control" ${isRequired ? "required" : ""}>`;
  });
}

/* --- Phần PeerJS và ghép nối cuộc gọi --- */
function initPeerConnection() {
  // Lấy stream âm thanh từ microphone
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(function(stream) {
      localStream = stream;
      // Khởi tạo Peer với id ngẫu nhiên
      peer = new Peer(null, { debug: 2 });
      peer.on('open', function(id) {
        console.log("My peer ID: " + id);
        joinLobby();
      });
      // Xử lý cuộc gọi đến (nếu không phải initiator)
      peer.on('call', function(call) {
        currentCall = call;
        call.answer(localStream);
        call.on('stream', function(remoteStream) {
          playRemoteStream(remoteStream);
        });
        call.on('close', function() {
          onCallEnded();
        });
      });
    })
    .catch(function(err) {
      console.error("Failed to get local audio stream", err);
    });
}

function playRemoteStream(stream) {
  var audio = document.getElementById('remoteAudio');
  audio.srcObject = stream;
  audio.play();
  document.getElementById('statusText').innerText = "In call";
}

// Thử kết nối đến lobby có id cố định "airtalk_lobby"
function joinLobby() {
  lobbyConn = peer.connect("airtalk_lobby", { reliable: true });
  var lobbyTimeout = setTimeout(function(){
    if (!lobbyConn || !lobbyConn.open) {
      // Nếu không kết nối được trong 3 giây, tự đảm nhận vai trò lobby
      becomeLobby();
    }
  }, 3000);
  lobbyConn.on('open', function() {
    clearTimeout(lobbyTimeout);
    // Gửi thông tin đăng ký lên lobby
    lobbyConn.send({ type: 'register', peerId: peer.id, userInfo: userInfo });
  });
  lobbyConn.on('data', function(data) {
    handleLobbyMessage(data);
  });
  lobbyConn.on('error', function(err) {
    console.log("Lobby connection error:", err);
    becomeLobby();
  });
}

// Nếu không tìm thấy lobby, client tự đóng vai trò lobby
function becomeLobby() {
  isLobby = true;
  waitingPeers = [];
  console.log("Acting as lobby");
  // Lắng nghe các kết nối đến từ các peer khác
  peer.on('connection', function(conn) {
    conn.on('data', function(data) {
      if (data.type === 'register') {
        waitingPeers.push({ conn: conn, peerId: data.peerId, userInfo: data.userInfo });
        tryMatch();
      }
    });
  });
}

// Xử lý thông điệp từ lobby (đối với client không đảm nhiệm lobby)
function handleLobbyMessage(data) {
  if (data.type === 'match') {
    // Nhận thông báo ghép nối từ lobby
    startCall(data.partner, data.initiator);
  }
}

// Thử ghép nối 2 peer trong danh sách chờ dựa trên thông tin cá nhân và yêu cầu
function tryMatch() {
  if (waitingPeers.length < 2) return;
  for (let i = 0; i < waitingPeers.length; i++) {
    for (let j = i + 1; j < waitingPeers.length; j++) {
      if (checkMatch(waitingPeers[i].userInfo, waitingPeers[j].userInfo)) {
        // Đối với cặp được ghép, người đăng ký trước làm initiator
        waitingPeers[i].conn.send({ type: 'match', partner: waitingPeers[j].peerId, initiator: true });
        waitingPeers[j].conn.send({ type: 'match', partner: waitingPeers[i].peerId, initiator: false });
        // Loại bỏ cặp đã ghép khỏi danh sách
        waitingPeers.splice(j, 1);
        waitingPeers.splice(i, 1);
        return;
      }
    }
  }
}

// Kiểm tra điều kiện ghép nối
function checkMatch(userA, userB) {
  return isMatch(userA, userB.desired) && isMatch(userB, userA.desired);
}

function isMatch(user, desired) {
  if (desired.gender && user.gender !== desired.gender) return false;
  if (desired.ageMin && user.age < desired.ageMin) return false;
  if (desired.ageMax && user.age > desired.ageMax) return false;
  if (desired.country && desired.country.trim() !== "" &&
      user.country.toLowerCase() !== desired.country.toLowerCase()) return false;
  if (desired.province && desired.province.trim() !== "" &&
      user.province.toLowerCase() !== desired.province.toLowerCase()) return false;
  return true;
}

function startCall(partnerId, initiator) {
  console.log("Matched with: " + partnerId + " Initiator: " + initiator);
  if (initiator) {
    // Nếu là người gọi, thực hiện cuộc gọi
    currentCall = peer.call(partnerId, localStream);
    currentCall.on('stream', function(remoteStream) {
      playRemoteStream(remoteStream);
    });
    currentCall.on('close', function() {
      onCallEnded();
    });
  }
  document.getElementById('statusText').innerText = "In call with " + partnerId;
}

function endCall() {
  if (currentCall) {
    currentCall.close();
    currentCall = null;
  }
  onCallEnded();
}

function onCallEnded() {
  document.getElementById('statusText').innerText = "Call ended. Waiting for match...";
  // Nếu người dùng chọn auto reconnect, đăng ký lại lên lobby
  if (document.getElementById('autoReconnect').checked) {
    if (!isLobby) {
      if (lobbyConn && lobbyConn.open) {
        lobbyConn.send({ type: 'register', peerId: peer.id, userInfo: userInfo });
      } else {
        joinLobby();
      }
    }
  }
}
