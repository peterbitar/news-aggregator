const crypto = require("crypto");

/**
 * Generate SimHash fingerprint for article content
 * SimHash is a locality-sensitive hashing algorithm that produces similar
 * hashes for similar content, making it ideal for duplicate detection.
 * 
 * @param {string} text - Article text content
 * @returns {string} 64-bit hash as hex string (16 characters)
 */
function generateSimHash(text) {
  if (!text || text.length === 0) {
    return '0'.repeat(16); // Return zero hash for empty text
  }
  
  // Tokenize text into words (simple approach)
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Replace punctuation with spaces
    .split(/\s+/)
    .filter(word => word.length > 2); // Filter short words
  
  if (words.length === 0) {
    return '0'.repeat(16);
  }
  
  // Create 64-bit vector (initialize to zeros)
  const vector = new Array(64).fill(0);
  
  // For each word, create hash and update vector
  for (const word of words) {
    // Create MD5 hash of word (128 bits)
    const hash = crypto.createHash('md5').update(word).digest('hex');
    
    // Convert hex to binary and update vector
    for (let i = 0; i < hash.length; i++) {
      const hexChar = parseInt(hash[i], 16);
      const binary = hexChar.toString(2).padStart(4, '0');
      
      for (let j = 0; j < 4; j++) {
        const bitIndex = (i * 4) + j;
        if (bitIndex < 64) {
          if (binary[j] === '1') {
            vector[bitIndex] += 1;
          } else {
            vector[bitIndex] -= 1;
          }
        }
      }
    }
  }
  
  // Convert vector to hash: positive values become 1, negative/zero become 0
  let hashString = '';
  for (let i = 0; i < 64; i += 4) {
    let hexValue = 0;
    for (let j = 0; j < 4 && (i + j) < 64; j++) {
      if (vector[i + j] > 0) {
        hexValue |= (1 << (3 - j));
      }
    }
    hashString += hexValue.toString(16);
  }
  
  return hashString;
}

/**
 * Calculate Hamming distance between two SimHash values
 * Hamming distance is the number of differing bits.
 * 
 * @param {string} hash1 - First SimHash (hex string)
 * @param {string} hash2 - Second SimHash (hex string)
 * @returns {number} Hamming distance (0-64)
 */
function hammingDistance(hash1, hash2) {
  if (!hash1 || !hash2 || hash1.length !== hash2.length) {
    return 64; // Max distance if invalid
  }
  
  let distance = 0;
  
  for (let i = 0; i < hash1.length; i++) {
    const hex1 = parseInt(hash1[i], 16);
    const hex2 = parseInt(hash2[i], 16);
    
    // XOR to find differing bits
    const diff = hex1 ^ hex2;
    
    // Count set bits in diff
    let bits = diff;
    while (bits > 0) {
      distance += bits & 1;
      bits >>= 1;
    }
  }
  
  return distance;
}

module.exports = {
  generateSimHash,
  hammingDistance,
};
