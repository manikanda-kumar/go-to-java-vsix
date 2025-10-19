package main

import "fmt"

func add(a int, b int) int {
	return a + b
}

func greet(name string) string {
	return "Hello, " + name
}

func divide(a, b float64) (float64, error) {
	if b == 0 {
		return 0, fmt.Errorf("division by zero")
	}
	return a / b, nil
}

func processNumbers(nums []int) (int, int, error) {
	if len(nums) == 0 {
		return 0, 0, fmt.Errorf("empty slice")
	}
	sum := 0
	product := 1
	for _, num := range nums {
		sum += num
		product *= num
	}
	return sum, product, nil
}

type Person struct {
	name string
}

func (p *Person) GetName() string {
	return p.name
}

func calculateStats(data map[string]int) (float64, int) {
	total := 0
	count := 0
	for _, value := range data {
		total += value
		count++
	}
	avg := float64(total) / float64(count)
	return avg, count
}
