package main

import (
	"errors"
	"fmt"
)

// User represents a user in the system
type User struct {
	Name   string `json:"name"`
	Age    int    `json:"age"`
	Email  string `json:"email,omitempty"`
	Active bool
}

// Reader is an interface for reading data
type Reader interface {
	Read(data []byte) (int, error)
	Close() error
}

// MaxRetries is the maximum number of retry attempts
const MaxRetries = 3

// defaultTimeout is the default timeout in seconds
var defaultTimeout = 30

// Add returns the sum of two integers
func Add(a, b int) int {
	return a + b
}

// Divide divides two numbers and returns error if divisor is zero
func Divide(a, b float64) (float64, error) {
	if b == 0 {
		return 0, errors.New("division by zero")
	}
	return a / b, nil
}

// ProcessItems processes a slice of items with metadata
func ProcessItems(items []string, metadata map[string]int) (int, error) {
	count := len(items)
	for _, v := range metadata {
		count += v
	}
	return count, nil
}

// NewUser creates a new User with the given name
func (u *User) SetName(name string) {
	u.Name = name
}

// GetFullInfo returns user information
func (u User) GetFullInfo() string {
	return fmt.Sprintf("%s (%d)", u.Name, u.Age)
}

// Sum calculates the sum of variadic integers
func Sum(numbers ...int) int {
	total := 0
	for _, n := range numbers {
		total += n
	}
	return total
}
