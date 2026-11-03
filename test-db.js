require("dotenv").config();

const mysql = require("mysql2/promise");

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 4000),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: {
        minVersion: "TLSv1.2"
    }
});

async function testConnection() {
    try {
        const [rows] = await pool.query(
            "SELECT DATABASE() AS database_name"
        );

        console.log("Database connected successfully!");
        console.log(rows[0]);
    } catch (error) {
        console.error("Connection failed:", error.message);
    } finally {
        await pool.end();
    }
}

testConnection();