const http = require('http');
const { Server } = require('socket.io');

const server = http.createServer();
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

let isGameRunning = false;
let drawnNumbers = [];
let gameTimer = null;

let pendingBingoClaims = [];
let isCheckingClaims = false;

const availablePatterns = [
  'fullHouse', 'fourCorners', 'horizontalLine', 'verticalLine', 
  'diagonal', 'letterL', 'letterO', 'letterC', 'letterF', 'letterT', 
  'letterY', 'letterZ', 'rectangle', 'twoPlus', 'twoPlusNoFree', 
  'twoSquare', 'threeSquare', 'twoSquareNoFree', 'threeSquareNoFree', 'fourSquareNoFree'
];

let currentRoundPatterns = ['fullHouse'];

function getRandomPatterns() {
  const shuffled = availablePatterns.concat().sort(function() {
    return 0.5 - Math.random();
  });
  return shuffled.slice(0, 2);
}

io.on('connection', function(socket) {
  console.log('🔗 ተጫዋች ተገናኝቷል ID:', socket.id);

  socket.on('start_game', function() {
    if (isGameRunning) return;
    isGameRunning = true;
    drawnNumbers = [];
    pendingBingoClaims = [];
    isCheckingClaims = false;
    
    currentRoundPatterns = getRandomPatterns();
    io.emit('server_patterns', { patterns: currentRoundPatterns });
    console.log('🎯 የዚህ ዙር ኦንላይን ቅጦች ተመርጠዋል:', currentRoundPatterns);

    console.log('🎮 Online ጨዋታ ተጀመረ (በየ 8 ሰከንዱ ቁጥር ይጠራል)');
    startNumberTimer();
  });

  function startNumberTimer() {
    if (gameTimer) clearInterval(gameTimer);

    gameTimer = setInterval(function() {
      if (drawnNumbers.length >= 75) {
        clearInterval(gameTimer);
        isGameRunning = false;
        io.emit('game_over', { message: 'ሁሉም ቁጥሮች አልቀዋል!', winnerCardIds: [] });
        return;
      }

      let nextNum;
      do {
        nextNum = Math.floor(Math.random() * 75) + 1;
      } while (drawnNumbers.includes(nextNum));

      drawnNumbers.push(nextNum);
      io.emit('number_drawn', { currentNumber: nextNum, allDrawn: drawnNumbers });
      console.log('📢 የተጠራ ቁጥር: ' + nextNum);
    }, 8000);
  }

  socket.on('claim_bingo', function(data) {
    const cardId = data.cardId;
    const matrix = data.matrix;
    const selectedPatterns = data.selectedPatterns || currentRoundPatterns;

    console.log('🔍 የካርድ #' + cardId + ' BINGO ጥያቄ ደርሷል');

    pendingBingoClaims.push({
      socket: socket,
      cardId: cardId,
      matrix: matrix,
      selectedPatterns: selectedPatterns,
      snapshot: drawnNumbers.concat()
    });

    if (!isCheckingClaims) {
      processPendingClaims();
    }
  });

  function processPendingClaims() {
    if (pendingBingoClaims.length === 0) {
      isCheckingClaims = false;
      if (isGameRunning) startNumberTimer();
      return;
    }

    isCheckingClaims = true;
    if (gameTimer) clearInterval(gameTimer);

    setTimeout(function() {
      let validWinnerCardIds = [];

      for (let i = 0; i < pendingBingoClaims.length; i++) {
        let claim = pendingBingoClaims[i];
        let isValidPattern = validatePatterns(claim.matrix, claim.snapshot, claim.selectedPatterns);
        if (isValidPattern) {
          let latestDrawnNumber = claim.snapshot[claim.snapshot.length - 1];
          let isLatest = checkIfCardWinsSpecificNumber(claim.matrix, claim.snapshot, claim.selectedPatterns, latestDrawnNumber);
          
          if (isLatest) {
            validWinnerCardIds.push(claim.cardId);
          } else {
            claim.socket.emit('bingo_blocked', { 
              cardId: claim.cardId, 
              message: 'ካርድ #' + claim.cardId + ' የማሸነፊያው ሰዓት አልፎታል (Late Claim Blocked)!' 
            });
          }
        } else {
          claim.socket.emit('bingo_blocked', { 
            cardId: claim.cardId, 
            message: 'ካርድ #' + claim.cardId + ' ቅጡን አላሟላም (Blocked)!' 
          });
        }
      }

      if (validWinnerCardIds.length > 0) {
        console.log('🏆 አሸናፊ ካርዶች ተገኙ:', validWinnerCardIds);
        isGameRunning = false;

        io.emit('game_over', { 
          winnerCardIds: validWinnerCardIds, 
          message: 'አሸናፊዎች ተገኙ! ካርዶች ቁጥር #' + validWinnerCardIds.join(', #') 
        });
        pendingBingoClaims = [];
      } else {
        pendingBingoClaims = [];
        isCheckingClaims = false;
        if (isGameRunning) {
          startNumberTimer();
        }
      }
    }, 4000);
  }

  socket.on('stop_game', function() {
    if (gameTimer) clearInterval(gameTimer);
    isGameRunning = false;
    pendingBingoClaims = [];
    isCheckingClaims = false;
    io.emit('game_over', { message: 'ጨዋታው ቆሟል/ታድሷል', winnerCardIds: [] });
  });

  socket.on('disconnect', function() {
    console.log('❌ ተቋርጧል:', socket.id);
  });
});

function checkIfCardWinsSpecificNumber(matrix, drawn, patterns, latestNum) {
  if (!validatePatterns(matrix, drawn, patterns)) return false;
  let drawnWithoutLatest = drawn.slice(0, drawn.length - 1);
  let wasAlreadyWonBefore = validatePatterns(matrix, drawnWithoutLatest, patterns);
  if (wasAlreadyWonBefore) return false;
  return true;
}

function validatePatterns(matrix, drawn, patterns) {
  if (!matrix || matrix.length !== 5) return false;

  for (let i = 0; i < patterns.length; i++) {
    let pattern = patterns[i];
    if (pattern.indexOf('fullHouse') !== -1) {
      if (!checkFullHouse(matrix, drawn)) return false;
    } else if (pattern.indexOf('horizontalLine') !== -1) {
      if (!checkHorizontal(matrix, drawn)) return false;
    } else if (pattern.indexOf('verticalLine') !== -1) {
      if (!checkVertical(matrix, drawn)) return false;
    } else if (pattern.indexOf('fourCorners') !== -1) {
      if (!checkFourCorners(matrix, drawn)) return false;
    } else if (pattern.indexOf('diagonal') !== -1) {
      if (!checkDiagonal(matrix, drawn)) return false;
    } else if (pattern.indexOf('rectangle') !== -1 || pattern.indexOf('letterO') !== -1) {
      if (!checkRectangle(matrix, drawn)) return false;
    } else if (pattern.indexOf('twoSquare') !== -1) {
      if (!checkDisjointSquares(matrix, drawn, 2, false)) return false;
    } else if (pattern.indexOf('threeSquare') !== -1) {
      if (!checkDisjointSquares(matrix, drawn, 3, false)) return false;
    } else if (pattern.indexOf('twoSquareNoFree') !== -1) {
      if (!checkDisjointSquares(matrix, drawn, 2, true)) return false;
    } else if (pattern.indexOf('threeSquareNoFree') !== -1) {
      if (!checkDisjointSquares(matrix, drawn, 3, true)) return false;
    } else if (pattern.indexOf('fourSquareNoFree') !== -1) {
      if (!checkDisjointSquares(matrix, drawn, 4, true)) return false;
    } else if (pattern.indexOf('twoPlusNoFree') !== -1) {
      if (!checkDisjointPluses(matrix, drawn, true)) return false;
    } else if (pattern.indexOf('twoPlus') !== -1) {
      if (!checkDisjointPluses(matrix, drawn, false)) return false;
    }
  }
  return true;
}

function isMarkedOrFree(num, drawn) {
  return num === 0 || drawn.includes(num);
}

function checkFullHouse(matrix, drawn) {
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      if (!isMarkedOrFree(matrix[r][c], drawn)) return false;
    }
  }
  return true;
}

function checkHorizontal(matrix, drawn) {
  for (let r = 0; r < 5; r++) {
    let rowComplete = true;
    for (let c = 0; c < 5; c++) {
      if (!isMarkedOrFree(matrix[r][c], drawn)) {
        rowComplete = false;
        break;
      }
    }
    if (rowComplete) return true;
  }
  return false;
}

function checkVertical(matrix, drawn) {
  for (let c = 0; c < 5; c++) {
    let colComplete = true;
    for (let r = 0; r < 5; r++) {
      if (!isMarkedOrFree(matrix[r][c], drawn)) {
        colComplete = false;
        break;
      }
    }
    if (colComplete) return true;
  }
  return false;
}

function checkFourCorners(matrix, drawn) {
  return isMarkedOrFree(matrix[0][0], drawn) &&
         isMarkedOrFree(matrix[0][4], drawn) &&
         isMarkedOrFree(matrix[4][0], drawn) &&
         isMarkedOrFree(matrix[4][4], drawn);
}

function checkDiagonal(matrix, drawn) {
  let d1 = true, d2 = true;
  for (let i = 0; i < 5; i++) {
    if (!isMarkedOrFree(matrix[i][i], drawn)) d1 = false;
    if (!isMarkedOrFree(matrix[i][4 - i], drawn)) d2 = false;
  }
  return d1 || d2;
}

function checkRectangle(matrix, drawn) {
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      if ((r === 0 || r === 4 || c === 0 || c === 4) && !isMarkedOrFree(matrix[r][c], drawn)) {
        return false;
      }
    }
  }
  return true;
}

function getSquareCells(r, c) {
  return [{r: r, c: c}, {r: r, c: c+1}, {r: r+1, c: c}, {r: r+1, c: c+1}];
}

function areCellsMarked(cells, matrix, drawn) {
  for (let i = 0; i < cells.length; i++) {
    let p = cells[i];
    if (!isMarkedOrFree(matrix[p.r][p.c], drawn)) return false;
  }
  return true;
}

function doCellsOverlap(c1, c2) {
  for (let i = 0; i < c1.length; i++) {
    for (let j = 0; j < c2.length; j++) {
      if (c1[i].r === c2[j].r && c1[i].c === c2[j].c) return true;
    }
  }
  return false;
}

function squareTouchesFree(r, c) {
  let cells = getSquareCells(r, c);
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].r === 2 && cells[i].c === 2) return true;
  }
  return false;
}

function checkDisjointSquares(matrix, drawn, targetCount, ignoreFree) {
  let validSquares = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (ignoreFree && squareTouchesFree(r, c)) continue;
      let cells = getSquareCells(r, c);
      if (areCellsMarked(cells, matrix, drawn)) {
        validSquares.push(cells);
      }
    }
  }

  if (validSquares.length < targetCount) return false;

  if (targetCount === 2) {
    return !doCellsOverlap(validSquares[0], validSquares[1]) || validSquares.length >= 2;
  } else if (targetCount === 3) {
    for (let i = 0; i < validSquares.length; i++) {
      for (let j = i + 1; j < validSquares.length; j++) {
        for (let k = j + 1; k < validSquares.length; k++) {
          if (!doCellsOverlap(validSquares[i], validSquares[j]) &&
              !doCellsOverlap(validSquares[i], validSquares[k]) &&
              !doCellsOverlap(validSquares[j], validSquares[k])) {
            return true;
          }
        }
      }
    }
    return false;
  } else if (targetCount === 4) {
    for (let i = 0; i < validSquares.length; i++) {
      for (let j = i + 1; j < validSquares.length; j++) {
        for (let k = j + 1; k < validSquares.length; k++) {
          for (let l = k + 1; l < validSquares.length; l++) {
            let group = [validSquares[i], validSquares[j], validSquares[k], validSquares[l]];
            let overlap = false;
            for (let x = 0; x < group.length; x++) {
              for (let y = x + 1; y < group.length; y++) {
                if (doCellsOverlap(group[x], group[y])) overlap = true;
              }
            }
            if (!overlap) return true;
          }
        }
      }
    }
    return false;
  }
  return validSquares.length >= targetCount;
}

function getPlusCells(r, c) {
  return [{r: r, c: c}, {r: r-1, c: c}, {r: r+1, c: c}, {r: r, c: c-1}, {r: r, c: c+1}];
}

function plusTouchesFree(r, c) {
  let cells = getPlusCells(r, c);
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].r === 2 && cells[i].c === 2) return true;
  }
  return false;
}

function checkDisjointPluses(matrix, drawn, ignoreFree) {
  let validPluses = [];
  for (let r = 1; r < 4; r++) {
    for (let c = 1; c < 4; c++) {
      if (ignoreFree && plusTouchesFree(r, c)) continue;
      let cells = getPlusCells(r, c);
      if (areCellsMarked(cells, matrix, drawn)) {
        validPluses.push(cells);
      }
    }
  }

  if (validPluses.length < 2) return false;
  for (let i = 0; i < validPluses.length; i++) {
    for (let j = i + 1; j < validPluses.length; j++) {
      if (!doCellsOverlap(validPluses[i], validPluses[j])) {
        return true;
      }
    }
  }
  return false;
}

const PORT = 3000;
server.listen(PORT, function() {
  console.log('🚀 Bingo Server በ Port ' + PORT + ' ላይ በትክክል እየሰራ ነው...');
});