var buf = new Uint32Array(3)

module.exports = {
    xor: function (payload, maskBytes, maskPos) {
        buf[0] = maskPos || 0
        buf[1] = payload.length
        for (buf[2]=0; buf[2] < buf[1]; buf[2]++) {
            payload[buf[2]] ^= maskBytes[buf[0]]
            buf[0] = (++buf[0]) & 3
        }
        return buf[0]
    }
}